// The rules of a proposal's **Signature**, ported from FRSG's
// shared/proposal-signing.ts: when Washington's **Notice to Customer** has to
// be shown, the exact wording a signer ticks, what makes a signing attempt
// refusable, and how the proposal as signed is sealed into one string with a
// fingerprint. Nothing here touches a database or a clock, so the mutation
// that approves (convex/proposals.ts) and the sign bar that asks for the
// signature read the same rules, and the box a customer ticks and the record
// Expand keeps can never say different things.
//
// Wording is versioned on purpose. The signature records the sentences the
// signer actually saw, so a later edit to either constant changes what new
// signers agree to and leaves every existing record telling the truth about
// its own day.
//
// Expand's changes to FRSG's: the notice follows the residential rule, with no
// upper bound; the consent sentence drops "on behalf of the customer", because
// the signer is the customer; there is no signer title and no paper path; and
// the seal takes Expand's frozen offer, whose Terms are clauses and whose site
// is the two printed lines.

import { sha256 } from "@noble/hashes/sha2.js";

import { WashingtonNoticeToCustomer, type ProposalTerm } from "./expand-business";
import { paymentTermsSentence, type ProposalTax } from "./proposal-pricing";
import { isWashingtonRegion } from "./wa-sales-tax";

// RCW 18.27.114(1)(a): residential work priced at $1,000 or more. FRSG's
// commercial arm stops at $60,000; the residential one has no ceiling.
export const NoticeFromCents = 100_000;

// Whether the notice goes on the signing page at all: Washington, and at or
// over the floor. A job outside Washington is not asked to acknowledge a
// notice Washington's statute requires.
export function noticeToCustomerApplies(
  region: string | null | undefined,
  totalCents: number,
): boolean {
  return isWashingtonRegion(region) && totalCents >= NoticeFromCents;
}

// The one tick that signs. It covers both halves Washington's electronic
// signature act wants spelled out — consent to sign electronically, and
// acceptance of the offer — and names the proposal by the number the customer
// knows it by.
export const SigningConsent = {
  version: "2026-09-23",
  wording(proposalNumber: number): string {
    return `I agree to sign this document electronically, and I accept Proposal ${proposalNumber}, including its Terms and Payment Terms.`;
  },
};

// Every way a signing attempt is short of a signature, in the order the form
// reads: who is signing, that they agreed, and that the notice was
// acknowledged where one was shown. The sign bar refuses locally with the same
// list the mutation refuses with.
export type SigningFault = "signer_name_required" | "consent_required" | "notice_required";

export function signingFaults(attempt: {
  signerName: string;
  consentTicked: boolean;
  noticeRequired: boolean;
  noticeTicked: boolean;
}): SigningFault[] {
  const faults: SigningFault[] = [];
  if (!attempt.signerName.trim()) faults.push("signer_name_required");
  if (!attempt.consentTicked) faults.push("consent_required");
  if (attempt.noticeRequired && !attempt.noticeTicked) faults.push("notice_required");
  return faults;
}

export function signingFaultMessage(fault: SigningFault): string {
  switch (fault) {
    case "signer_name_required":
      return "Type your name to sign.";
    case "consent_required":
      return "Tick the box to sign electronically and accept the proposal.";
    case "notice_required":
      return `Tick the box under the ${WashingtonNoticeToCustomer.title} to confirm you have received it.`;
  }
}

// The proposal as it stands at the moment of signing: everything Send froze,
// the identity the customer knows it by, and the two facts that make it
// Expand's offer — when it was sent and by whom. This is what gets sealed.
// Nothing in it is a live reference, so the same proposal seals to the same
// bytes on any later day.
//
// The Estimator's email is deliberately not here: it names whom to call about
// the offer, not a term of it, and the part of it that is evidence — the
// sender's name — is sealed as `sentByName`.
export type SealedProposalInput = {
  proposalId: string;
  number: number;
  // The Proposal ID, as every sheet's footer prints it.
  code: string;
  name: string;
  customerName: string;
  site: { street: string; city: string };
  sentAt: number;
  sentByName: string;
  offer: {
    solutions: {
      solutionId: string;
      title: string;
      scopeOfWork: string;
      priceCents: number;
      // The lines the paper lists under the solution: name, quantity and unit,
      // and no money.
      lineItems: { name: string; quantity: number; unit: string }[];
    }[];
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    depositPercent: number;
    terms: ProposalTerm[];
    tax: ProposalTax;
    // The Notes and exclusions the letter printed: contract text, so inside
    // what the fingerprint covers.
    notes?: string;
  };
};

export type SealedProposal = {
  // One canonical serialisation: keys in a fixed order, no whitespace, so two
  // seals of the same proposal are byte-for-byte equal and the fingerprint
  // below means something.
  document: string;
  // SHA-256 of the document's UTF-8 bytes, as lowercase hex.
  fingerprint: string;
};

export function sealProposal(input: SealedProposalInput): SealedProposal {
  const document = canonicalJson({
    proposalId: input.proposalId,
    number: input.number,
    code: input.code,
    name: input.name,
    customerName: input.customerName,
    site: input.site,
    sentAt: input.sentAt,
    sentByName: input.sentByName,
    solutions: input.offer.solutions,
    subtotalCents: input.offer.subtotalCents,
    taxCents: input.offer.taxCents,
    totalCents: input.offer.totalCents,
    tax: input.offer.tax,
    depositPercent: input.offer.depositPercent,
    paymentTerms: paymentTermsSentence(input.offer.depositPercent),
    terms: input.offer.terms,
    notes: input.offer.notes,
  });
  return { document, fingerprint: fingerprintOf(document) };
}

// The fingerprint of any sealed document, exported so a stored copy can be
// checked against its stored fingerprint without re-sealing. Synchronous, so
// Approve seals inside its own mutation.
export function fingerprintOf(document: string): string {
  const bytes = new TextEncoder().encode(document);
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// JSON with object keys sorted at every depth and `undefined` members left
// out, which is what makes the serialisation a function of the value rather
// than of whichever code path built the object.
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member === undefined) continue;
      sorted[key] = sortKeys(member);
    }
    return sorted;
  }
  return value;
}
