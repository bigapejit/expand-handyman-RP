import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { fingerprintOf, sealProposal, SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address: 8.9% at location 0605.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

const iPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

// Outbound HTTP, stubbed at fetch: DOR answers with Vancouver's rate, Resend
// from `resend`, and every call to Resend is kept to be asserted on.
let resend: ReturnType<typeof vi.fn>;
let resendCalls: { headers: Record<string, string>; body: Record<string, unknown> }[];

beforeEach(() => {
  // Scheduled sends run only when a test calls `deliver()`. The clock is set
  // to 8:30pm Pacific on 23 September, which is already the 24th in UTC, so a
  // date read in the wrong zone shows.
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 24, 3, 30));
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
  resend = vi.fn(async () => Response.json({ id: "resend-message-1" }));
  resendCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.resend.com/"))
      return new Response(vancouverRate, { status: 200, headers: { "content-type": "text/xml" } });
    resendCalls.push({
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return resend(input, init);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// A refusal's data, as the page reads it.
async function refusal(pending: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await pending;
  } catch (error) {
    let data = (error as { data?: unknown }).data;
    while (typeof data === "string") data = JSON.parse(data);
    return data as Record<string, unknown>;
  }
  throw new Error("Expected a refusal.");
}

function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const stranger = t.withIdentity({
    subject: "someone",
    email: "someone@example.com",
    emailVerified: true,
  });
  const customer = () =>
    t.run((ctx) =>
      ctx.db.insert("customers", { name: "Maria Delgado", email: "maria@example.com", phone: "" }),
    );
  const site = (customerId: Id<"customers">, region = "WA") =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: "1300FRANKLIN",
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region,
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
  // A sent proposal whose one solution is two hours at `unitCostCents`,
  // marked up 10% and taxed 8.9% in Washington.
  const sent = async (
    unitCostCents = 25_000,
    at?: { customerId: Id<"customers">; siteId: Id<"sites"> },
  ) => {
    const customerId = at?.customerId ?? (await customer());
    const siteId = at?.siteId ?? (await site(customerId));
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title: "Fix gate" });
    await owner.mutation(api.solutions.update, {
      solutionId,
      description: "Rehang the gate.",
      lineItems: [{ name: "Gate labor", quantity: 2, unitCostCents, unit: "HR" }],
    });
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    resendCalls = [];
    const token = (await read(customerId, proposalId)).liveToken;
    if (!token) throw new Error("No live link.");
    return { customerId, siteId, solutionId, proposalId, token };
  };
  const read = async (customerId: Id<"customers">, proposalId: Id<"proposals">) => {
    const tab = await owner.query(api.proposals.forCustomer, { customerId });
    const found = tab.proposals.find((p) => p.proposalId === proposalId);
    if (!found) throw new Error("Proposal not on the tab.");
    return found;
  };
  const approval = (token: string, noticeTicked = false) => ({
    token,
    signerName: "Maria Delgado",
    consentTicked: true,
    noticeTicked,
    consentWordingVersion: SigningConsent.version,
    noticeWordingVersion: WashingtonNoticeToCustomer.version,
    userAgent: iPhone,
  });
  // The customer opening their link, as the page does.
  const open = (token: string) =>
    t.mutation(api.signingLinks.opened, { token, userAgent: iPhone });
  const deliver = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, owner, stranger, customer, site, sent, read, approval, open, deliver };
}

describe("Approve", () => {
  test("records the signature, seals the offer and ends the link as approved", async () => {
    const { t, owner, sent, read, approval, open } = fixture();
    const { customerId, proposalId, token } = await sent();
    // The owner's preview comes first and is not the customer's view.
    await owner.mutation(api.signingLinks.opened, { token, userAgent: "owner browser" });
    vi.advanceTimersByTime(60_000);
    await open(token);
    const firstView = Date.now();
    vi.advanceTimersByTime(60_000);
    await open(token);
    vi.advanceTimersByTime(60_000);

    await t.mutation(api.proposals.approve, approval(token));

    const proposal = await t.run((ctx) => ctx.db.get(proposalId));
    expect(proposal?.state).toBe("approved");
    expect(proposal?.approvedAt).toBe(Date.now());
    expect(proposal?.signature).toMatchObject({
      signerName: "Maria Delgado",
      signedAt: Date.now(),
      userAgent: iPhone,
      firstOpenedAt: firstView,
      consentWording:
        "I agree to sign this document electronically, and I accept Proposal 1, including its Terms and Payment Terms.",
      consentWordingVersion: SigningConsent.version,
      noticeShown: false,
      noticeTicked: false,
    });
    expect(proposal?.signature?.noticeWording).toBeUndefined();
    expect(proposal?.signature?.noticeWordingVersion).toBeUndefined();

    const row = await read(customerId, proposalId);
    expect(row.state).toBe("approved");
    expect(row.liveToken).toBeNull();
    expect(row.links[0]).toMatchObject({ endedReason: "approved", endedAt: Date.now() });
    expect(row.signerName).toBe("Maria Delgado");
  });

  test("seals what Send froze, and the seal never moves with later edits", async () => {
    const { t, owner, sent, approval } = fixture();
    const { customerId, siteId, solutionId, proposalId, token } = await sent();
    await t.mutation(api.proposals.approve, approval(token));
    const proposal = await t.run((ctx) => ctx.db.get(proposalId));
    const sealed = proposal!.signature!.sealed;
    const frozen = proposal!.frozen!;

    expect(fingerprintOf(sealed.document)).toBe(sealed.fingerprint);
    expect(sealed).toEqual(
      sealProposal({
        proposalId,
        number: 1,
        code: "1300FRANKLIN-P1",
        name: "Fix gate",
        customerName: "Maria Delgado",
        site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
        sentAt: proposal!.sentAt!,
        sentByName: "Andrew Putilin",
        offer: frozen,
      }),
    );
    expect(JSON.parse(sealed.document)).toMatchObject({ totalCents: 59_895 });

    // Everything live the offer was made from moves; the signed copy doesn't.
    await owner.mutation(api.solutions.update, { solutionId, title: "Replace gate" });
    await owner.mutation(api.customers.update, {
      customerId,
      name: "Maria D. Delgado",
      email: "maria@example.com",
      phone: "",
    });
    await t.run((ctx) => ctx.db.patch(siteId, { addressLine1: "1400 Franklin St" }));
    const page = await t.query(api.signingLinks.page, { token });
    expect(page?.paper.signature?.fingerprint).toBe(sealed.fingerprint);
    expect(page?.paper.solutions[0].title).toBe("Fix gate");
    expect(page?.paper.site.street).toBe("1300 Franklin St");
  });

  test("below $1,000 asks for no notice", async () => {
    const { t, sent, approval } = fixture();
    const { token } = await sent();
    expect((await t.query(api.signingLinks.page, { token }))?.noticeRequired).toBe(false);
    await t.mutation(api.proposals.approve, approval(token));
  });

  test("at $1,000 or more, with no upper limit, the notice is required and its wording kept", async () => {
    const { t, sent, approval } = fixture();
    // Two hours at $50,000 is $110,000 marked up: far past FRSG's $60,000 band.
    const { proposalId, token } = await sent(5_000_000);
    expect((await t.query(api.signingLinks.page, { token }))?.noticeRequired).toBe(true);

    expect(await refusal(t.mutation(api.proposals.approve, approval(token)))).toMatchObject({
      code: "notice_required",
    });
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.state).toBe("sent");

    await t.mutation(api.proposals.approve, approval(token, true));
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.signature).toMatchObject({
      noticeShown: true,
      noticeTicked: true,
      noticeWording: WashingtonNoticeToCustomer.text,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
  });

  test("the $1,000 floor is the total, tax included", async () => {
    const { t, sent } = fixture();
    // Two hours at $450 is $990 marked up, under $1,000, but $1,078.11 taxed.
    const { token } = await sent(45_000);
    expect((await t.query(api.signingLinks.page, { token }))?.noticeRequired).toBe(true);
    // At $410 it is $902, and $982.28 taxed.
    const cheaper = await sent(41_000);
    expect((await t.query(api.signingLinks.page, { token: cheaper.token }))?.noticeRequired).toBe(
      false,
    );
  });

  test("outside Washington no notice is asked for, whatever the total", async () => {
    const { t, customer, site, sent } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "OR");
    const { token } = await sent(5_000_000, { customerId, siteId });
    expect((await t.query(api.signingLinks.page, { token }))?.noticeRequired).toBe(false);
  });

  test("refuses a blank name, a missing consent tick and stale wording", async () => {
    const { t, sent, approval } = fixture();
    const { proposalId, token } = await sent();
    expect(
      await refusal(
        t.mutation(api.proposals.approve, { ...approval(token), signerName: "  ", consentTicked: false }),
      ),
    ).toMatchObject({ code: "signer_name_required" });
    expect(
      await refusal(
        t.mutation(api.proposals.approve, { ...approval(token), consentWordingVersion: "2020-01-01" }),
      ),
    ).toMatchObject({ code: "wording_stale" });
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.state).toBe("sent");
  });

  test("a second Approve or Decline through the same link is refused, and the link stays readable", async () => {
    const { t, sent, approval, open } = fixture();
    const { proposalId, token } = await sent();
    await t.mutation(api.proposals.approve, approval(token));

    expect(await refusal(t.mutation(api.proposals.approve, approval(token)))).toMatchObject({
      code: "link_ended",
    });
    expect(
      await refusal(t.mutation(api.proposals.declineFromLink, { token, reason: "Changed my mind" })),
    ).toMatchObject({ code: "link_ended" });
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.state).toBe("approved");

    expect(await t.query(api.signingLinks.resolve, { token })).toBe("proposal");
    const page = await t.query(api.signingLinks.page, { token });
    expect(page?.paper.state).toBe("approved");
    expect(page?.paper.signature).toMatchObject({ signerName: "Maria Delgado", noticeShown: false });
    // Reading the signed copy is still a view.
    expect(await open(token)).not.toBeNull();
  });

  test("an unknown, withdrawn or replaced link cannot approve", async () => {
    const { t, owner, sent, read, approval } = fixture();
    expect(await refusal(t.mutation(api.proposals.approve, approval("x".repeat(43))))).toMatchObject(
      { code: "link_ended" },
    );
    const { customerId, proposalId, token } = await sent();
    await owner.action(api.proposals.resend, { proposalId });
    expect(await refusal(t.mutation(api.proposals.approve, approval(token)))).toMatchObject({
      code: "link_ended",
    });
    const fresh = (await read(customerId, proposalId)).liveToken!;
    await owner.mutation(api.proposals.withdraw, { proposalId });
    expect(await refusal(t.mutation(api.proposals.approve, approval(fresh)))).toMatchObject({
      code: "link_ended",
    });
  });

  test("an approved proposal can't be withdrawn, re-sent or declined by the owner", async () => {
    const { t, owner, sent, approval } = fixture();
    const { proposalId, token } = await sent();
    await t.mutation(api.proposals.approve, approval(token));
    await expect(owner.mutation(api.proposals.withdraw, { proposalId })).rejects.toThrow(
      /Only a sent proposal/,
    );
    await expect(owner.action(api.proposals.resend, { proposalId })).rejects.toThrow(
      /Only a sent proposal/,
    );
    await expect(owner.mutation(api.proposals.decline, { proposalId })).rejects.toThrow(
      /Only a sent proposal/,
    );
  });

  test("the panel counts the other Sent proposals left at the site", async () => {
    const { t, sent, read, approval } = fixture();
    const first = await sent();
    const at = { customerId: first.customerId, siteId: first.siteId };
    await sent(30_000, at);
    await sent(35_000, at);
    await t.mutation(api.proposals.approve, approval(first.token));
    expect((await read(first.customerId, first.proposalId)).otherSentAtSite).toBe(2);
  });
});

describe("The approval emails", () => {
  test("go separately to the customer and to contact@expandhandyman.com, dated in Pacific time", async () => {
    const { t, sent, read, approval, deliver } = fixture();
    const { customerId, proposalId, token } = await sent();
    await t.mutation(api.proposals.approve, approval(token));
    expect((await read(customerId, proposalId)).decisionEmails).toEqual([
      { to: "maria@example.com", email: null },
      { to: "contact@expandhandyman.com", email: null },
    ]);
    await deliver();

    const text = [
      "Maria Delgado accepted Proposal 1300FRANKLIN-P1 for 1300 Franklin St, Vancouver, WA 98660 on September 23, 2026: Fix gate, $598.95.",
      "",
      "The signed copy, with the terms as accepted, is here:",
      `https://staff.expandhandyman.com/sign/${token}`,
      "",
      "Keep this email as your record of the agreement. Expand Handyman will be in touch about the next steps.",
    ].join("\n");
    expect(resendCalls.map((call) => call.body)).toEqual([
      {
        from: "Expand Handyman <proposals@expandhandyman.com>",
        to: ["maria@example.com"],
        reply_to: "contact@expandhandyman.com",
        subject: "Signed: Expand Handyman proposal for 1300 Franklin St",
        text,
        tags: [{ name: "letter", value: "approval" }],
      },
      {
        from: "Expand Handyman <proposals@expandhandyman.com>",
        to: ["contact@expandhandyman.com"],
        reply_to: "contact@expandhandyman.com",
        subject: "Signed: Expand Handyman proposal for 1300 Franklin St",
        text,
        tags: [{ name: "letter", value: "approval" }],
      },
    ]);
    expect(new Set(resendCalls.map((call) => call.headers["idempotency-key"])).size).toBe(2);
    expect((await read(customerId, proposalId)).decisionEmails).toEqual([
      { to: "maria@example.com", email: { outcome: "sent", id: "resend-message-1" } },
      { to: "contact@expandhandyman.com", email: { outcome: "sent", id: "resend-message-1" } },
    ]);
  });

  test("a failed send is recorded and leaves the approval standing", async () => {
    const { t, sent, read, approval, deliver } = fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { customerId, proposalId, token } = await sent();
    resend.mockImplementation(async () => new Response("down", { status: 503 }));
    await t.mutation(api.proposals.approve, approval(token));
    await deliver();
    const row = await read(customerId, proposalId);
    expect(row.state).toBe("approved");
    expect(row.decisionEmails.map((sent) => sent.email)).toEqual([
      { outcome: "fault", fault: "HTTP_503" },
      { outcome: "fault", fault: "HTTP_503" },
    ]);
  });
});

describe("Decline through the link", () => {
  test("takes an optional reason, ends the link and emails contact@expandhandyman.com only", async () => {
    const { t, sent, read, deliver } = fixture();
    const { customerId, proposalId, token } = await sent();
    await t.mutation(api.proposals.declineFromLink, { token, reason: "  Too expensive  " });

    const proposal = await t.run((ctx) => ctx.db.get(proposalId));
    expect(proposal).toMatchObject({
      state: "declined",
      declinedAt: Date.now(),
      declineReason: "Too expensive",
      declinedBy: "customer",
    });
    expect(proposal?.signature).toBeUndefined();
    const row = await read(customerId, proposalId);
    expect(row.links[0].endedReason).toBe("declined");

    await deliver();
    expect(resendCalls.map((call) => call.body)).toEqual([
      {
        from: "Expand Handyman <proposals@expandhandyman.com>",
        to: ["contact@expandhandyman.com"],
        reply_to: "contact@expandhandyman.com",
        subject: "Declined: Proposal 1300FRANKLIN-P1 for 1300 Franklin St",
        text: [
          "Maria Delgado declined Proposal 1300FRANKLIN-P1 for 1300 Franklin St, Vancouver, WA 98660: Fix gate.",
          "",
          "Their reason: Too expensive",
        ].join("\n"),
        tags: [{ name: "letter", value: "decline_notice" }],
      },
    ]);
    expect((await read(customerId, proposalId)).decisionEmails).toEqual([
      { to: "contact@expandhandyman.com", email: { outcome: "sent", id: "resend-message-1" } },
    ]);
  });

  test("says so when no reason was given, and the link still shows the paper, declined", async () => {
    const { t, sent, deliver } = fixture();
    const { token } = await sent();
    await t.mutation(api.proposals.declineFromLink, { token, reason: "   " });
    await deliver();
    expect(String(resendCalls[0].body.text)).toMatch(/\n\nThey gave no reason\.$/);

    expect(await t.query(api.signingLinks.resolve, { token })).toBe("proposal");
    const page = await t.query(api.signingLinks.page, { token });
    expect(page?.paper).toMatchObject({ state: "declined", declinedAt: Date.now() });
    expect(await refusal(t.mutation(api.proposals.declineFromLink, { token }))).toMatchObject({
      code: "link_ended",
    });
    expect(
      await refusal(
        t.mutation(api.proposals.approve, {
          token,
          signerName: "Maria Delgado",
          consentTicked: true,
          noticeTicked: false,
        }),
      ),
    ).toMatchObject({ code: "link_ended" });
  });
});

describe("Decline recorded by the owner", () => {
  test("takes an optional reason, ends the link as declined and emails nobody", async () => {
    const { t, owner, sent, read, deliver } = fixture();
    const { customerId, proposalId, token } = await sent();
    await owner.mutation(api.proposals.decline, { proposalId, reason: "Said no on the phone" });
    await deliver();

    expect(resendCalls).toEqual([]);
    const row = await read(customerId, proposalId);
    expect(row).toMatchObject({
      state: "declined",
      declineReason: "Said no on the phone",
      declinedBy: "owner",
      decisionEmails: [],
    });
    expect(row.links[0].endedReason).toBe("declined");
    // The customer never answered through the link, so it has nothing of
    // theirs to show.
    expect(await t.query(api.signingLinks.resolve, { token })).toBe("ended");
    expect(await t.query(api.signingLinks.page, { token })).toBeNull();
  });

  test("works without a reason, only on a sent proposal, and only for the owner", async () => {
    const { t, owner, stranger, sent } = fixture();
    const { proposalId } = await sent();
    await expect(stranger.mutation(api.proposals.decline, { proposalId })).rejects.toThrow();
    await owner.mutation(api.proposals.decline, { proposalId });
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.declineReason).toBeUndefined();
    await expect(owner.mutation(api.proposals.decline, { proposalId })).rejects.toThrow(
      /Only a sent proposal/,
    );
  });
});

describe("The customers list after a decision", () => {
  test("names the latest decision by when it was made, not when the row last changed", async () => {
    const { t, owner, sent, approval } = fixture();
    const first = await sent();
    const at = { customerId: first.customerId, siteId: first.siteId };
    await t.mutation(api.proposals.approve, approval(first.token));
    vi.advanceTimersByTime(60_000);
    const second = await sent(30_000, at);
    await owner.mutation(api.proposals.decline, { proposalId: second.proposalId });
    vi.advanceTimersByTime(60_000);
    // Marking the older, approved proposal Recommended touches its row.
    await owner.mutation(api.proposals.setRecommended, {
      proposalId: first.proposalId,
      recommended: true,
    });
    const [row] = await owner.query(api.customers.list, {});
    expect(row.proposalActivity).toEqual({ kind: "decided", state: "declined" });
  });
});
