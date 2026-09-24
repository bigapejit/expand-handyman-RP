import { describe, expect, it } from "vitest";

import {
  conversationUrl,
  eventKind,
  isUnread,
  parseLeadEvent,
  parseMessageEvent,
  timeAgo,
  webhookAuthorized,
} from "./thumbtack";

// A NegotiationCreatedV4 body in the spec's shape
// (docs/research/thumbtack-webhooks.md, section 3).
const leadBody = () => ({
  event: {
    eventType: "NegotiationCreatedV4",
    description: "A new negotiation",
    webhookID: "1",
    triggeredAt: "2026-09-23T17:20:00Z",
  },
  data: {
    negotiationID: "519153480500518912",
    createdAt: "2026-09-23T17:18:01Z",
    customer: {
      customerID: "519153480034934784",
      firstName: " Olivia ",
      lastName: "Young",
      phone: "555-555-5555",
    },
    business: { businessID: "468046965846925323", name: "Expand Handyman", imageURL: "" },
    request: {
      requestID: "r1",
      customerID: "519153480034934784",
      description: "Gate sags and drags on the path.",
      category: { categoryID: "c1", name: "Fence Repair" },
      location: { address1: "1300 Franklin St", address2: "", city: "Vancouver", state: "WA", zipCode: "98660" },
      details: [{ question: "Type of fence", answer: "Wood" }],
      attachments: [
        { fileName: "gate.jpg", fileSize: 1139, mimeType: "image/jpeg", url: "https://x/gate.jpg", description: "the gate" },
      ],
    },
    estimate: { type: "Fixed", total: "$250.00" },
    leadPrice: "$25.00",
  },
});

const messageBody = (from = "Customer") => ({
  event: { eventType: "MessageCreatedV4" },
  data: {
    messageID: "519153481515696128",
    negotiationID: "519153480500518912",
    customer: { customerID: "519153480034934784", displayName: "Olivia Y." },
    from,
    text: "Are you available on my date?",
    attachments: [],
    sentAt: "2024-06-13T17:18:01Z",
  },
});

describe("parseLeadEvent", () => {
  it("reads the spec's shape into a lead and its customer", () => {
    expect(parseLeadEvent(leadBody())).toEqual({
      negotiationId: "519153480500518912",
      thumbtackCustomerId: "519153480034934784",
      arrivedAt: Date.UTC(2026, 8, 23, 17, 18, 1),
      customerName: "Olivia Young",
      phone: "555-555-5555",
      category: "Fence Repair",
      description: "Gate sags and drags on the path.",
      details: [{ question: "Type of fence", answer: "Wood" }],
      location: { address1: "1300 Franklin St", city: "Vancouver", state: "WA", zipCode: "98660" },
      attachments: [
        { fileName: "gate.jpg", fileSize: 1139, mimeType: "image/jpeg", url: "https://x/gate.jpg", description: "the gate" },
      ],
      estimate: { type: "Fixed", total: "$250.00" },
      leadPrice: "$25.00",
    });
  });

  // The docs' GET sample: no envelope, createTime, displayName, category and
  // details at the top, the location under the customer.
  it("tolerates the docs' sample drift", () => {
    const parsed = parseLeadEvent({
      negotiationID: "519153480500518912",
      status: "active",
      category: { categoryID: "201565295100608806", name: "Kitchen Remodel" },
      customer: {
        customerID: "519153480034934784",
        displayName: "Olivia Y.",
        location: { city: "San Francisco", state: "CA", zipCode: "94117" },
      },
      details: [{ question: "Project scope", answer: "Full kitchen renovation" }],
      createTime: "2024-06-13T17:18:01Z",
    });
    expect(parsed).toMatchObject({
      customerName: "Olivia Y.",
      phone: "",
      category: "Kitchen Remodel",
      arrivedAt: Date.UTC(2024, 5, 13, 17, 18, 1),
      location: { city: "San Francisco", state: "CA", zipCode: "94117" },
      details: [{ question: "Project scope", answer: "Full kitchen renovation" }],
      attachments: [],
    });
    expect(parsed).not.toHaveProperty("estimate");
    expect(parsed).not.toHaveProperty("leadPrice");
  });

  it("falls back to the event's time, then faults without one", () => {
    const body = leadBody();
    delete (body.data as Partial<typeof body.data>).createdAt;
    expect(parseLeadEvent(body)).toMatchObject({ arrivedAt: Date.UTC(2026, 8, 23, 17, 20) });
    delete (body.event as Partial<typeof body.event>).triggeredAt;
    expect(parseLeadEvent(body)).toEqual({ fault: "The lead has no createdAt." });
  });

  it("faults without the IDs it files a lead under", () => {
    const noLead = leadBody();
    delete (noLead.data as Partial<typeof noLead.data>).negotiationID;
    expect(parseLeadEvent(noLead)).toHaveProperty("fault");
    const noCustomer = leadBody();
    noCustomer.data.customer.customerID = "";
    noCustomer.data.request.customerID = "";
    expect(parseLeadEvent(noCustomer)).toHaveProperty("fault");
    expect(parseLeadEvent(null)).toHaveProperty("fault");
  });

  it("names a customer with no name on the payload", () => {
    const body = leadBody();
    body.data.customer.firstName = "";
    body.data.customer.lastName = "";
    expect(parseLeadEvent(body)).toMatchObject({ customerName: "Thumbtack customer" });
  });
});

describe("parseMessageEvent", () => {
  it("reads a customer's message", () => {
    expect(parseMessageEvent(messageBody())).toEqual({
      messageId: "519153481515696128",
      negotiationId: "519153480500518912",
      from: "customer",
      text: "Are you available on my date?",
      attachments: [],
      sentAt: Date.UTC(2024, 5, 13, 17, 18, 1),
      customerDisplayName: "Olivia Y.",
      thumbtackCustomerId: "519153480034934784",
    });
  });

  it("reads the owner's reply", () => {
    const body = messageBody("Business");
    delete (body.data as Partial<typeof body.data>).customer;
    expect(parseMessageEvent(body)).toMatchObject({ from: "business" });
    expect(parseMessageEvent(body)).not.toHaveProperty("customerDisplayName");
  });

  it("faults on a sender it cannot place or a missing time", () => {
    expect(parseMessageEvent(messageBody("Robot"))).toHaveProperty("fault");
    const body = messageBody();
    body.data.sentAt = "not a date";
    expect(parseMessageEvent(body)).toEqual({ fault: "The message has no sentAt." });
  });
});

describe("eventKind", () => {
  it("sorts deliveries by event type", () => {
    expect(eventKind(leadBody())).toBe("lead");
    expect(eventKind(messageBody())).toBe("message");
    expect(eventKind({ event: { eventType: "ReviewCreatedV4" } })).toBe("other");
    expect(eventKind({})).toBe("other");
    expect(eventKind("nonsense")).toBe("other");
  });
});

describe("isUnread", () => {
  it("is a customer message after the owner last opened the lead", () => {
    expect(isUnread({})).toBe(false);
    expect(isUnread({ lastCustomerMessageAt: 5 })).toBe(true);
    expect(isUnread({ lastCustomerMessageAt: 5, openedAt: 5 })).toBe(false);
    expect(isUnread({ lastCustomerMessageAt: 6, openedAt: 5 })).toBe(true);
  });
});

describe("conversationUrl", () => {
  it("points at the lead in Thumbtack's pro inbox", () => {
    expect(conversationUrl("519153480500518912")).toBe(
      "https://www.thumbtack.com/pro-inbox/messages/519153480500518912",
    );
  });
});

describe("webhookAuthorized", () => {
  const basic = (credentials: string) => ({ Authorization: `Basic ${btoa(credentials)}` });

  it("takes the secret as a Basic password under any username", () => {
    expect(webhookAuthorized(new Headers(basic("thumbtack:s3cret")), "s3cret")).toBe(true);
    expect(webhookAuthorized(new Headers(basic("anyone:s3cret")), "s3cret")).toBe(true);
    expect(webhookAuthorized(new Headers(basic(":s3cret")), "s3cret")).toBe(true);
    // A colon in the password is part of it.
    expect(webhookAuthorized(new Headers(basic("u:a:b")), "a:b")).toBe(true);
  });

  it("takes the secret in X-Thumbtack-Secret", () => {
    expect(webhookAuthorized(new Headers({ "X-Thumbtack-Secret": "s3cret" }), "s3cret")).toBe(true);
    expect(webhookAuthorized(new Headers({ "x-thumbtack-secret": "s3cret" }), "s3cret")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(webhookAuthorized(new Headers(basic("s3cret:wrong")), "s3cret")).toBe(false);
    expect(webhookAuthorized(new Headers(basic("s3cret")), "s3cret")).toBe(false);
    expect(webhookAuthorized(new Headers({ Authorization: "Basic !!!" }), "s3cret")).toBe(false);
    expect(webhookAuthorized(new Headers({ Authorization: "Bearer s3cret" }), "s3cret")).toBe(false);
    expect(webhookAuthorized(new Headers({ "X-Thumbtack-Secret": "s3cre" }), "s3cret")).toBe(false);
    expect(webhookAuthorized(new Headers(), "s3cret")).toBe(false);
  });

  it("authorizes nothing without a secret", () => {
    expect(webhookAuthorized(new Headers(basic("u:")), "")).toBe(false);
    expect(webhookAuthorized(new Headers({ "X-Thumbtack-Secret": "" }), "")).toBe(false);
    expect(webhookAuthorized(new Headers(), undefined)).toBe(false);
  });
});

describe("timeAgo", () => {
  const now = Date.UTC(2026, 8, 23, 18, 30);
  const minutes = (n: number) => now - n * 60_000;

  it("says just now under a minute, and for a clock slightly ahead", () => {
    expect(timeAgo(now, now)).toBe("just now");
    expect(timeAgo(now - 59_000, now)).toBe("just now");
    expect(timeAgo(now + 30_000, now)).toBe("just now");
  });

  it("counts whole minutes, hours, then days", () => {
    expect(timeAgo(minutes(1), now)).toBe("1m ago");
    expect(timeAgo(minutes(59), now)).toBe("59m ago");
    expect(timeAgo(minutes(60), now)).toBe("1h ago");
    expect(timeAgo(minutes(23 * 60 + 59), now)).toBe("23h ago");
    expect(timeAgo(minutes(24 * 60), now)).toBe("1d ago");
    expect(timeAgo(minutes(40 * 24 * 60), now)).toBe("40d ago");
  });
});
