import { describe, expect, it } from "vitest";

import { WashingtonNoticeToCustomer } from "./expand-business";
import {
  fingerprintOf,
  noticeToCustomerApplies,
  sealProposal,
  SigningConsent,
  signingFaultMessage,
  signingFaults,
  type SealedProposalInput,
} from "./proposal-signing";

describe("when the Notice to Customer is shown", () => {
  // RCW 18.27.114(1)(a), the residential arm: $1,000 or more, with no upper
  // bound, and only in Washington.
  it.each([
    [99_999, false],
    [100_000, true],
    [5_999_900, true],
    [6_000_000, true],
    [250_000_000, true],
  ])("at a Washington site with a %i-cent total: %s", (totalCents, shown) => {
    expect(noticeToCustomerApplies("WA", totalCents)).toBe(shown);
  });

  it("is never shown in Oregon, whatever the total", () => {
    expect(noticeToCustomerApplies("OR", 100_000)).toBe(false);
    expect(noticeToCustomerApplies("Oregon", 1_000_000)).toBe(false);
    expect(noticeToCustomerApplies(undefined, 1_000_000)).toBe(false);
  });

  it("reads the state however the site spells it", () => {
    expect(noticeToCustomerApplies("Washington", 200_000)).toBe(true);
    expect(noticeToCustomerApplies(" wa ", 200_000)).toBe(true);
  });

  it("carries the statute's wording, filled from the business facts, with a version", () => {
    expect(WashingtonNoticeToCustomer.title).toBe("NOTICE TO CUSTOMER");
    expect(WashingtonNoticeToCustomer.text).toContain(
      "This contractor is registered with the state of Washington, registration no. 606 261 044,",
    );
    expect(WashingtonNoticeToCustomer.text).toContain("YOUR PROPERTY MAY BE LIENED.");
    expect(WashingtonNoticeToCustomer.acknowledgement).toBe(
      "I have received a copy of this disclosure statement.",
    );
    expect(WashingtonNoticeToCustomer.version).toMatch(/^rcw-18\.27\.114:/);
  });
});

describe("the consent wording", () => {
  it("covers electronic signing and acceptance, and names the proposal by number", () => {
    expect(SigningConsent.wording(2)).toBe(
      "I agree to sign this document electronically, and I accept Proposal 2, including its Terms and Payment Terms.",
    );
    // Expand's own wording, so not FRSG's version.
    expect(SigningConsent.version).not.toBe("2026-09-02");
  });
});

describe("what stops a signing attempt", () => {
  const complete = {
    signerName: "Pat Owner",
    consentTicked: true,
    noticeRequired: true,
    noticeTicked: true,
  };

  it("finds nothing wrong with a complete attempt", () => {
    expect(signingFaults(complete)).toEqual([]);
    expect(signingFaults({ ...complete, noticeRequired: false, noticeTicked: false })).toEqual([]);
  });

  it("lists every fault at once, in reading order", () => {
    expect(
      signingFaults({ signerName: "  ", consentTicked: false, noticeRequired: true, noticeTicked: false }),
    ).toEqual(["signer_name_required", "consent_required", "notice_required"]);
  });

  it("only asks for the notice tick where the notice was shown", () => {
    expect(signingFaults({ ...complete, noticeRequired: false, noticeTicked: false })).toEqual([]);
    expect(signingFaults({ ...complete, noticeTicked: false })).toEqual(["notice_required"]);
  });

  it("words each fault for the sign bar", () => {
    expect(signingFaultMessage("signer_name_required")).toBe("Type your name to sign.");
    expect(signingFaultMessage("consent_required")).toMatch(/Tick the box/);
    expect(signingFaultMessage("notice_required")).toContain("NOTICE TO CUSTOMER");
  });
});

describe("the sealed copy", () => {
  const input: SealedProposalInput = {
    proposalId: "proposal-1",
    number: 2,
    code: "1300FRANKLIN-P2",
    name: "Fix gate",
    customerName: "Maria Delgado",
    site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
    sentAt: 1_756_800_000_000,
    sentByName: "Andrew Putilin",
    offer: {
      solutions: [
        {
          solutionId: "solution-1",
          title: "Fix gate",
          scopeOfWork: "Rehang the gate.",
          priceCents: 55_000,
          lineItems: [
            { name: "Gate hinge", quantity: 2, unit: "EA" },
            { name: "Labor", quantity: 2, unit: "HR" },
          ],
        },
      ],
      subtotalCents: 55_000,
      taxCents: 4_895,
      totalCents: 59_895,
      depositPercent: 50,
      terms: [{ heading: "Acceptance.", body: "Signing this proposal accepts it." }],
      tax: { source: "lookup", rate: 0.089, locationCode: "0605", period: "Q32026" },
    },
  };

  it("serialises the frozen offer with its Terms and Payment Terms, once", () => {
    const parsed = JSON.parse(sealProposal(input).document) as Record<string, unknown>;

    expect(parsed.number).toBe(2);
    expect(parsed.code).toBe("1300FRANKLIN-P2");
    expect(parsed.customerName).toBe("Maria Delgado");
    expect(parsed.totalCents).toBe(59_895);
    expect(parsed.terms).toEqual([
      { body: "Signing this proposal accepts it.", heading: "Acceptance." },
    ]);
    expect(parsed.paymentTerms).toBe("50% on signing, 50% on completion");
    expect(parsed.tax).toEqual({ source: "lookup", rate: 0.089, locationCode: "0605", period: "Q32026" });
    expect(parsed.sentByName).toBe("Andrew Putilin");
  });

  it("fingerprints the same sealed copy the same way every time", () => {
    const first = sealProposal(input);
    const second = sealProposal(input);

    expect(first.document).toBe(second.document);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintOf(first.document)).toBe(first.fingerprint);
  });

  it("does not depend on the order the offer's keys were built in", () => {
    const reordered: SealedProposalInput = {
      ...input,
      offer: {
        tax: input.offer.tax,
        terms: input.offer.terms,
        depositPercent: input.offer.depositPercent,
        totalCents: input.offer.totalCents,
        taxCents: input.offer.taxCents,
        subtotalCents: input.offer.subtotalCents,
        solutions: input.offer.solutions,
      },
      site: { city: "Vancouver, WA 98660", street: "1300 Franklin St" },
    };

    expect(sealProposal(reordered).fingerprint).toBe(sealProposal(input).fingerprint);
  });

  it("changes when a cent of the offer changes", () => {
    const dearer = { ...input, offer: { ...input.offer, totalCents: 59_896 } };

    expect(sealProposal(dearer).fingerprint).not.toBe(sealProposal(input).fingerprint);
  });

  // The line items are on the paper the customer signed, so they are inside
  // what the fingerprint covers.
  it("seals the line items the paper listed, and changes when one of them does", () => {
    const parsed = JSON.parse(sealProposal(input).document) as {
      solutions: { lineItems: unknown }[];
    };
    expect(parsed.solutions[0].lineItems).toEqual([
      { name: "Gate hinge", quantity: 2, unit: "EA" },
      { name: "Labor", quantity: 2, unit: "HR" },
    ]);

    const relabelled: SealedProposalInput = {
      ...input,
      offer: {
        ...input.offer,
        solutions: [
          {
            ...input.offer.solutions[0],
            lineItems: [
              { name: "Gate hinge", quantity: 2, unit: "LF" },
              { name: "Labor", quantity: 2, unit: "HR" },
            ],
          },
        ],
      },
    };
    expect(sealProposal(relabelled).fingerprint).not.toBe(sealProposal(input).fingerprint);
  });

  // The exclusions are contract text: a fingerprint that cannot tell two
  // offers apart by them is not evidence of what was accepted.
  it("seals the Notes and exclusions, and changes when they do", () => {
    const noted: SealedProposalInput = {
      ...input,
      offer: { ...input.offer, notes: "Excludes painting." },
    };
    const amended: SealedProposalInput = {
      ...input,
      offer: { ...input.offer, notes: "Includes painting." },
    };

    expect(JSON.parse(sealProposal(noted).document)).toMatchObject({
      notes: "Excludes painting.",
    });
    expect(sealProposal(noted).fingerprint).not.toBe(sealProposal(amended).fingerprint);
    expect(sealProposal(noted).fingerprint).not.toBe(sealProposal(input).fingerprint);
  });

  it("leaves an absent optional field out rather than writing null", () => {
    expect(sealProposal(input).document).not.toContain("notes");
    expect(sealProposal(input).document).not.toContain("null");
  });
});
