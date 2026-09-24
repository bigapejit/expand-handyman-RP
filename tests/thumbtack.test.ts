import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address, for the proposals a lead's customer
// is sent.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 23, 18, 0));
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
  vi.stubEnv("THUMBTACK_WEBHOOK_SECRET", "s3cret");
  vi.stubGlobal("fetch", async (input: string | URL | Request) =>
    String(input).startsWith("https://api.resend.com/")
      ? Response.json({ id: "resend-message-1" })
      : new Response(vancouverRate, { status: 200, headers: { "content-type": "text/xml" } }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// A NegotiationCreatedV4 body in the spec's shape.
const leadEvent = (
  negotiationID = "900",
  customer: { customerID?: string; phone?: string; firstName?: string } = {},
) => ({
  event: { eventType: "NegotiationCreatedV4", webhookID: "1", triggeredAt: "2026-09-23T17:00:00Z" },
  data: {
    negotiationID,
    createdAt: "2026-09-23T17:00:00Z",
    customer: {
      customerID: customer.customerID ?? "c-1",
      firstName: customer.firstName ?? "Olivia",
      lastName: "Young",
      phone: customer.phone ?? "555-555-5555",
    },
    business: { businessID: "b-1", name: "Expand Handyman", imageURL: "" },
    request: {
      requestID: `r-${negotiationID}`,
      customerID: customer.customerID ?? "c-1",
      description: "Gate sags.",
      category: { categoryID: "cat", name: "Fence Repair" },
      location: { city: "Vancouver", state: "WA", zipCode: "98660" },
      details: [],
      attachments: [],
    },
    estimate: { type: "Fixed", total: "$250.00" },
    leadPrice: "$25.00",
  },
});

const messageEvent = (
  messageID: string,
  from: "Customer" | "Business",
  sentAt: string,
  negotiationID = "900",
) => ({
  event: { eventType: "MessageCreatedV4" },
  data: {
    messageID,
    negotiationID,
    from,
    ...(from === "Customer"
      ? { customer: { customerID: "c-1", displayName: "Olivia Y." } }
      : { business: { businessID: "b-1", displayName: "Expand Handyman" } }),
    text: `${from} says hi`,
    attachments: [],
    sentAt,
  },
});

function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const receive = (body: unknown) => t.mutation(internal.leads.receive, { body });
  const leads = () => t.run((ctx) => ctx.db.query("leads").collect());
  const customers = () => t.run((ctx) => ctx.db.query("customers").collect());
  const events = () => t.run((ctx) => ctx.db.query("thumbtackEvents").collect());
  const site = (customerId: Id<"customers">) =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: "1300FRANKLIN",
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: "place-1300FRANKLIN",
        latitude: 45.63,
        longitude: -122.67,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  // A proposal to `customerId` sent through the real Send, with its live token.
  const send = async (customerId: Id<"customers">) => {
    const siteId = await site(customerId);
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title: "Fix gate" });
    await owner.mutation(api.solutions.update, {
      solutionId,
      description: "Rehang the gate.",
      lineItems: [{ name: "Gate labor", quantity: 2, unitCostCents: 25_000, unit: "HR" }],
    });
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    await owner.action(api.proposals.send, { proposalId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const tab = await owner.query(api.proposals.forCustomer, { customerId });
    const token = tab.proposals.find((p) => p.proposalId === proposalId)?.liveToken;
    if (!token) throw new Error("No live link.");
    return token;
  };
  const approve = (token: string) =>
    t.action(api.proposals.approve, {
      token,
      signerName: "Olivia Young",
      consentTicked: true,
      noticeTicked: true,
      consentWordingVersion: SigningConsent.version,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
  return { t, owner, receive, leads, customers, events, send, approve };
}

describe("a lead event", () => {
  test("makes a customer marked with a Thumbtack number and a lead at New", async () => {
    const { owner, receive, leads, customers, events } = fixture();
    expect(await receive(leadEvent())).toBe("lead");

    const [customer] = await customers();
    expect(customer).toMatchObject({
      name: "Olivia Young",
      email: "",
      phone: "+15555555555",
      phoneFrom: "thumbtack",
    });
    const [lead] = await leads();
    expect(lead).toMatchObject({
      customerId: customer._id,
      negotiationId: "900",
      thumbtackCustomerId: "c-1",
      arrivedAt: Date.UTC(2026, 8, 23, 17, 0),
      category: "Fence Repair",
      leadPrice: "$25.00",
      stage: "new",
      stageChangedAt: Date.now(),
    });
    expect(await events()).toMatchObject([{ eventType: "NegotiationCreatedV4", outcome: "lead" }]);
    // The Customers list carries the mark for the page to show.
    const [listed] = await owner.query(api.customers.list, {});
    expect(listed.phoneFrom).toBe("thumbtack");
  });

  test("keeps a number the validator would refuse on the lead, not the customer", async () => {
    const { owner, receive, customers, leads } = fixture();
    await receive(leadEvent("900", { phone: "555-5555 ext 12" }));
    expect((await customers())[0]).toMatchObject({ phone: "" });
    expect((await customers())[0]).not.toHaveProperty("phoneFrom");
    expect((await leads())[0]).toMatchObject({ phone: "555-5555 ext 12" });
    const [row] = await owner.query(api.leads.board, {});
    expect(row.phone).toBe("555-5555 ext 12");
  });

  test("a late lead for a known Thumbtack customer repoints the placeholder and drops its stand-in", async () => {
    const { receive, customers, leads } = fixture();
    await receive(leadEvent("700", { customerID: "c-9", phone: "555-000-9999" }));
    // The owner's reply arrives before the lead itself: a business message
    // carries no customer block, so the stand-in is blank.
    await receive(messageEvent("m-1", "Business", "2026-09-23T16:00:00Z", "777"));
    expect(await customers()).toHaveLength(2);

    expect(await receive(leadEvent("777", { customerID: "c-9", phone: "555-000-9999" }))).toBe("lead");
    const held = await customers();
    expect(held).toHaveLength(1);
    expect(await leads()).toHaveLength(2);
    for (const lead of await leads()) expect(lead.customerId).toBe(held[0]._id);
  });

  test("arriving twice is a duplicate with one lead", async () => {
    const { receive, leads, customers, events } = fixture();
    await receive(leadEvent());
    expect(await receive(leadEvent())).toBe("duplicate");
    expect(await leads()).toHaveLength(1);
    expect(await customers()).toHaveLength(1);
    expect((await events()).map((e) => e.outcome)).toEqual(["lead", "duplicate"]);
  });

  test("a second lead from the same Thumbtack customer joins their customer", async () => {
    const { receive, leads, customers } = fixture();
    await receive(leadEvent("900"));
    // A new relay number on the second request still finds them.
    await receive(leadEvent("901", { phone: "555-000-1111" }));
    const [customer] = await customers();
    expect(await customers()).toHaveLength(1);
    expect((await leads()).map((l) => l.customerId)).toEqual([customer._id, customer._id]);
  });

  test("a lead whose phone matches a hand-added customer joins them, unmarked", async () => {
    const { t, receive, leads, customers } = fixture();
    const handAdded = await t.run((ctx) =>
      ctx.db.insert("customers", { name: "Olivia Young", email: "olivia@example.com", phone: "+15555555555" }),
    );
    await receive(leadEvent("900", { customerID: "c-9", phone: "(555) 555-5555" }));
    expect(await customers()).toHaveLength(1);
    expect((await leads())[0].customerId).toBe(handAdded);
    expect((await customers())[0]).not.toHaveProperty("phoneFrom");
  });

  test("an unreadable lead is logged as rejected", async () => {
    const { receive, leads, events } = fixture();
    const body = { event: { eventType: "NegotiationCreatedV4" }, data: {} };
    expect(await receive(body)).toBe("rejected");
    expect(await leads()).toHaveLength(0);
    expect(await events()).toMatchObject([{ outcome: "rejected", note: "The lead has no negotiationID.", body }]);
  });
});

describe("a message event", () => {
  test("from the customer marks the lead Unread, and opening it clears that", async () => {
    const { owner, receive } = fixture();
    await receive(leadEvent());
    expect(await receive(messageEvent("m-1", "Customer", "2026-09-23T17:05:00Z"))).toBe("message");

    const [row] = await owner.query(api.leads.board, {});
    expect(row).toMatchObject({
      customerName: "Olivia Young",
      phone: "+15555555555",
      unread: true,
      stage: "new",
      lastMessageAt: Date.UTC(2026, 8, 23, 17, 5),
      lastCustomerMessageAt: Date.UTC(2026, 8, 23, 17, 5),
      lastMessage: { text: "Customer says hi", from: "customer", sentAt: Date.UTC(2026, 8, 23, 17, 5) },
    });
    expect(await owner.query(api.leads.unreadCount, {})).toBe(1);

    await owner.mutation(api.leads.open, { leadId: row._id });
    expect((await owner.query(api.leads.board, {}))[0].unread).toBe(false);
    expect(await owner.query(api.leads.unreadCount, {})).toBe(0);
  });

  test("from the business moves New to Talking and is not Unread", async () => {
    const { owner, receive } = fixture();
    await receive(leadEvent());
    vi.advanceTimersByTime(60_000);
    await receive(messageEvent("m-1", "Business", "2026-09-23T17:05:00Z"));
    const [row] = await owner.query(api.leads.board, {});
    expect(row).toMatchObject({ stage: "talking", stageChangedAt: Date.now(), unread: false });
    expect(row).not.toHaveProperty("lastCustomerMessageAt");
  });

  test("arriving twice is a duplicate with one message", async () => {
    const { owner, receive, leads } = fixture();
    await receive(leadEvent());
    await receive(messageEvent("m-1", "Customer", "2026-09-23T17:05:00Z"));
    expect(await receive(messageEvent("m-1", "Customer", "2026-09-23T17:05:00Z"))).toBe("duplicate");
    const [lead] = await leads();
    const [withChat] = await owner.query(api.leads.forCustomer, { customerId: lead.customerId });
    expect(withChat.messages).toHaveLength(1);
  });

  test("for an unknown negotiation makes a placeholder lead, filled in by its lead event", async () => {
    const { owner, receive, leads, customers, events } = fixture();
    await receive(messageEvent("m-1", "Customer", "2026-09-23T16:00:00Z", "777"));

    const [placeholder] = await leads();
    expect(placeholder).toMatchObject({
      negotiationId: "777",
      category: "Thumbtack message",
      description: "",
      location: { city: "", state: "", zipCode: "" },
      arrivedAt: Date.UTC(2026, 8, 23, 16, 0),
      stage: "new",
    });
    expect(await customers()).toMatchObject([{ name: "Olivia Y.", email: "", phone: "" }]);
    expect((await events())[0]).toMatchObject({ outcome: "message", note: expect.stringContaining("placeholder") });

    // The lead's own webhook, arriving late, fills it in rather than
    // standing as a duplicate.
    expect(await receive(leadEvent("777"))).toBe("lead");
    expect(await leads()).toHaveLength(1);
    expect((await leads())[0]).toMatchObject({ category: "Fence Repair", lastCustomerMessageAt: Date.UTC(2026, 8, 23, 16, 0) });
    expect(await customers()).toMatchObject([{ name: "Olivia Young", phone: "+15555555555", phoneFrom: "thumbtack" }]);
    const [lead] = await owner.query(api.leads.forCustomer, { customerId: placeholder.customerId });
    expect(lead.messages).toHaveLength(1);
  });
});

test("a lead's thread is its chat oldest first, and null once the lead is gone", async () => {
  const { t, owner, receive, leads } = fixture();
  await receive(leadEvent());
  // Out of order, as deliveries may come.
  await receive(messageEvent("m-2", "Business", "2026-09-23T17:10:00Z"));
  await receive(messageEvent("m-1", "Customer", "2026-09-23T17:05:00Z"));
  const [lead] = await leads();

  const messages = await owner.query(api.leads.thread, { leadId: lead._id });
  expect(messages?.map((m) => [m.messageId, m.from])).toEqual([
    ["m-1", "customer"],
    ["m-2", "business"],
  ]);

  await t.run((ctx) => ctx.db.delete(lead._id));
  expect(await owner.query(api.leads.thread, { leadId: lead._id })).toBeNull();
});

test("an unknown event type is ignored and logged", async () => {
  const { receive, leads, events } = fixture();
  const body = { event: { eventType: "ReviewCreatedV4" }, data: { stars: 5 } };
  expect(await receive(body)).toBe("ignored");
  expect(await leads()).toHaveLength(0);
  expect(await events()).toMatchObject([{ eventType: "ReviewCreatedV4", outcome: "ignored", body }]);
});

describe("stages", () => {
  test("a proposal Send moves the customer's leads to Quoted and Approve to Won", async () => {
    const { t, owner, receive, leads, send, approve } = fixture();
    await receive(leadEvent("900"));
    await receive(leadEvent("901"));
    const [first, second] = await leads();
    await owner.mutation(api.leads.setStage, { leadId: second._id, stage: "lost" });
    // Send needs somewhere to email the proposal.
    await t.run((ctx) => ctx.db.patch(first.customerId, { email: "olivia@example.com" }));

    const token = await send(first.customerId);
    expect((await leads()).map((l) => l.stage)).toEqual(["quoted", "lost"]);

    await approve(token);
    expect((await leads()).map((l) => l.stage)).toEqual(["won", "lost"]);
    // Won and Lost are not open, so an Unread one would not count.
    expect(await owner.query(api.leads.unreadCount, {})).toBe(0);
  });

  test("the owner can move a lead to any stage", async () => {
    const { owner, receive, leads } = fixture();
    await receive(leadEvent());
    const [lead] = await leads();
    await owner.mutation(api.leads.setStage, { leadId: lead._id, stage: "won" });
    await owner.mutation(api.leads.setStage, { leadId: lead._id, stage: "talking" });
    expect((await leads())[0].stage).toBe("talking");
  });
});

describe("owner only", () => {
  test("refuses anyone else", async () => {
    const { t, receive, leads } = fixture();
    await receive(leadEvent());
    const [lead] = await leads();
    const stranger = t.withIdentity({ subject: "someone", email: "someone@example.com", emailVerified: true });
    await expect(stranger.query(api.leads.board, {})).rejects.toThrow(/Owner access/);
    await expect(stranger.query(api.leads.unreadCount, {})).rejects.toThrow(/Owner access/);
    await expect(stranger.query(api.leads.thread, { leadId: lead._id })).rejects.toThrow(/Owner access/);
    await expect(stranger.mutation(api.leads.open, { leadId: lead._id })).rejects.toThrow(/Owner access/);
    await expect(
      stranger.mutation(api.leads.setStage, { leadId: lead._id, stage: "lost" }),
    ).rejects.toThrow(/Owner access/);
  });
});

describe("customers.update", () => {
  test("drops the Thumbtack number mark only when the phone changes", async () => {
    const { owner, receive, customers } = fixture();
    await receive(leadEvent());
    const [customer] = await customers();
    const edit = { customerId: customer._id, name: "Olivia Young", email: "olivia@example.com" };
    await owner.mutation(api.customers.update, { ...edit, phone: "(555) 555-5555" });
    expect((await customers())[0].phoneFrom).toBe("thumbtack");
    await owner.mutation(api.customers.update, { ...edit, phone: "(555) 123-4567" });
    expect((await customers())[0]).not.toHaveProperty("phoneFrom");
  });
});

describe("POST /thumbtack", () => {
  const post = (
    t: ReturnType<typeof convexTest>,
    body: string,
    headers: Record<string, string> = { Authorization: `Basic ${btoa("thumbtack:s3cret")}` },
  ) => t.fetch("/thumbtack", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });

  test("takes an authorized lead", async () => {
    const { t, leads } = fixture();
    const response = await post(t, JSON.stringify(leadEvent()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await leads()).toHaveLength(1);
  });

  test("takes the secret in the custom header too", async () => {
    const { t, leads } = fixture();
    const response = await post(t, JSON.stringify(leadEvent()), { "X-Thumbtack-Secret": "s3cret" });
    expect(response.status).toBe(200);
    expect(await leads()).toHaveLength(1);
  });

  test("refuses a wrong secret without writing anything", async () => {
    const { t, leads, events } = fixture();
    const response = await post(t, JSON.stringify(leadEvent()), { "X-Thumbtack-Secret": "guess" });
    expect(response.status).toBe(401);
    expect(await leads()).toHaveLength(0);
    expect(await events()).toEqual([]);
  });

  test("is shut, and logs nothing, while no secret is set", async () => {
    vi.stubEnv("THUMBTACK_WEBHOOK_SECRET", "");
    const { t, events } = fixture();
    expect((await post(t, JSON.stringify(leadEvent()))).status).toBe(401);
    expect(await events()).toHaveLength(0);
  });

  test("answers a body that is not JSON with 400, and logs it", async () => {
    const { t, events } = fixture();
    expect((await post(t, "{not json")).status).toBe(400);
    expect(await events()).toMatchObject([{ outcome: "rejected", body: "{not json", note: "The body is not JSON." }]);
  });

  test("answers 500 and logs the raw body when it cannot be stored", async () => {
    const { t, events } = fixture();
    // A field name Convex cannot store.
    const raw = JSON.stringify({ event: { eventType: "ReviewCreatedV4" }, $bad: 1 });
    expect((await post(t, raw)).status).toBe(500);
    expect(await events()).toMatchObject([{ eventType: "ReviewCreatedV4", outcome: "rejected", body: raw }]);
  });
});
