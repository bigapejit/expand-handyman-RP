import type { UserIdentity } from "convex/server";
import type { Infer } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { frozenProposal } from "./schema";
import { proposalTerms, Unknown } from "../lib/expand-business";
import type { PaperProposal } from "../lib/proposal-paper";
import {
  depositBlockers,
  proposalDisplayName,
  proposalMoney,
  recipientBlockers,
  sendBlockers,
  splitPayment,
  storedDeposit,
  type SendBlocker,
} from "../lib/proposal-pricing";
import { proposalCode } from "../lib/proposals";
import { siteCityLine, siteStreetLine } from "../lib/sites";
import { offeredLineItems, priceStoredSolution } from "../lib/solution-pricing";

// What a **Proposal** offers, read one way for every state (CONTEXT.md). A
// draft is priced live from its solutions, its site, its customer and the
// signed-in owner, as if sent now. Past Draft it is the block **Send** froze,
// as is. Send freezes this same answer plus the address it went to, so the
// draft's **Proposal paper** and the sent one are equal by construction. The
// panel, the staff paper, the customer's link, the **PDF copy** and Duplicate
// all read through here.
//
// The module holds no Convex functions of its own: it is the one reader the
// functions in convex/proposals.ts, convex/signingLinks.ts and
// convex/pdfCopies.ts share, so the next thing an offer carries is written
// into the validator in convex/schema.ts and into this file, and nowhere else.

// The offer as Send stored it on the proposal.
export type FrozenProposal = Infer<typeof frozenProposal>;

// One solution as the offer carries it. A draft may hold one nobody has
// priced yet, which Send refuses; the frozen block never does.
export type OfferedSolution = Omit<FrozenProposal["solutions"][number], "priceCents"> & {
  priceCents: number | null;
};

// What the customer is offered, in the frozen block's own shape less the
// address it went to, which only Send knows. A frozen block is an Offer as
// it stands.
export type Offer = Omit<FrozenProposal, "sentTo" | "solutions"> & {
  solutions: OfferedSolution[];
};

// The **Proposal paper** as the owner reads it in the staff app: a draft's
// has no sent date yet.
export type StaffPaper = Omit<PaperProposal, "sentAt"> & { sentAt: number | null };

// The offer of any proposal, or null when its site is gone. It asks whether
// Send froze a block rather than which state the proposal is in, which is
// what the panel has always asked: a row past Draft that somehow holds no
// block still reads live for the owner, and never reaches a customer, whose
// paper comes from `sentPaper` alone.
export async function offerOf(
  ctx: QueryCtx,
  proposal: Doc<"proposals">,
): Promise<Offer | null> {
  if (proposal.frozen) return proposal.frozen;
  const site = await ctx.db.get(proposal.siteId);
  if (!site) return null;
  const [customer, identity, solutions] = await Promise.all([
    ctx.db.get(site.customerId),
    ctx.auth.getUserIdentity(),
    liveSolutions(ctx, proposal),
  ]);
  const priced = solutions.map((solution) => ({
    solution,
    price: priceStoredSolution(solution),
  }));
  return {
    code: proposalCode(site.name, proposal.number),
    customerName: customer?.name ?? Unknown,
    // The state rides along for the Notice to Customer, which answers to the
    // state the offer was sent in.
    site: { street: siteStreetLine(site), city: siteCityLine(site), region: site.region },
    estimator: estimatorOf(identity),
    solutions: priced.map(({ solution, price }) => ({
      solutionId: solution._id,
      title: solution.title,
      scopeOfWork: solution.description,
      // Null rather than zero while nobody has priced it: the staff paper
      // counts it, and Send refuses it by name.
      priceCents: price?.priceCents ?? null,
      // The customer's half of each line: no unit cost ever leaves here.
      lineItems: offeredLineItems(solution.lineItems),
      ...(solution.materialAllowanceCents === undefined
        ? {}
        : { materialAllowanceCents: solution.materialAllowanceCents }),
    })),
    ...proposalMoney(
      priced.map(({ price }) => price),
      proposal.tax,
    ),
    ...termsOf(proposal),
    // The wording the customer signs under, fixed at Send.
    terms: proposalTerms(),
  };
}

// What a proposal is called: the name the owner typed, or the solutions it
// offers, in order.
export function offerTitle(
  proposal: { name?: string },
  offer: { solutions: readonly { title: string }[] },
): string {
  return proposalDisplayName(
    proposal.name,
    offer.solutions.map((solution) => solution.title),
  );
}

// Every reason Send would be refused, in the order they read. The panel's
// button and Send itself both ask here, so the button never names reasons
// the mutation would not.
export function sendBlockersFor(offer: Offer, sendTo: string | null): SendBlocker[] {
  return [
    ...sendBlockers(
      offer.solutions.map((solution) => solution.priceCents),
      offer.tax,
    ),
    ...depositBlockers(splitPayment(offer.totalCents, storedDeposit(offer))),
    ...recipientBlockers(sendTo),
  ];
}

// The block Send stores: the offer as the draft's paper already shows it,
// plus the address it went to. This is the one seam between an Offer and a
// FrozenProposal, so what Send freezes can never drift from what the owner
// read before pressing it.
export function freezeOffer(offer: Offer, sentTo: string): FrozenProposal {
  return {
    ...offer,
    sentTo,
    solutions: offer.solutions.map((solution) => {
      // Unreachable past Send's refusal, which names every unpriced solution.
      // Stated rather than defaulted, because a solution frozen at $0 would
      // be a price Expand never offered.
      if (solution.priceCents === null)
        throw new Error("A solution with no price reached Send.");
      return { ...solution, priceCents: solution.priceCents };
    }),
  };
}

// The staff paper: a draft laid out from its offer as if sent now, with no
// sent date, since "now" is the page's to say. Past Draft it is the
// customer's own paper, read from what Send froze and nothing else, so the
// owner reads exactly what the customer's link shows.
export function paperOf(proposal: Doc<"proposals">, offer: Offer): StaffPaper | null {
  if (proposal.state === "draft") return { ...layOut(proposal, offer), sentAt: null };
  return sentPaper(proposal);
}

// A proposal past Draft as its paper, read wholly from what Send froze. The
// customer's link and the **PDF copy** come in here rather than through
// `offerOf`, so no customer path can ever reach a live solution, customer or
// site.
export function sentPaper(proposal: Doc<"proposals">): PaperProposal | null {
  const frozen = proposal.frozen;
  if (proposal.state === "draft" || !frozen || proposal.sentAt === undefined) return null;
  return { ...layOut(proposal, frozen), sentAt: proposal.sentAt };
}

// What Duplicate starts its new draft from: the same work on the same terms.
export function draftFieldsOf(
  offer: Offer,
): Pick<Doc<"proposals">, "solutionIds" | "depositPercent" | "depositCents" | "tax" | "notes"> {
  return {
    solutionIds: offer.solutions.map((solution) => solution.solutionId),
    ...termsOf(offer),
  };
}

// The terms a proposal sets beside its solutions, read off a draft or an
// offer alike. The one place the optional ones are left out rather than
// written as undefined.
function termsOf(
  from: Pick<Offer, "depositPercent" | "depositCents" | "tax" | "notes">,
): Pick<Offer, "depositPercent" | "depositCents" | "tax" | "notes"> {
  return {
    depositPercent: from.depositPercent,
    // A set Deposit overrides the percent, which stays for switching back.
    ...(from.depositCents === undefined ? {} : { depositCents: from.depositCents }),
    tax: from.tax,
    ...(from.notes === undefined ? {} : { notes: from.notes }),
  };
}

// The one projection of an offer onto the paper. Line items go through
// `offeredLineItems` once more, so a block frozen before units were part of
// the copy still prints every unit.
function layOut(proposal: Doc<"proposals">, offer: Offer): Omit<PaperProposal, "sentAt"> {
  return {
    proposalId: proposal._id,
    number: proposal.number,
    code: offer.code,
    name: offerTitle(proposal, offer),
    state: proposal.state,
    recommended: proposal.recommended,
    estimator: offer.estimator,
    customerName: offer.customerName,
    site: { street: offer.site.street, city: offer.site.city },
    // No prices: the paper prints one figure inside a solution, its material
    // allowance.
    solutions: offer.solutions.map((solution) => ({
      solutionId: solution.solutionId,
      title: solution.title,
      scopeOfWork: solution.scopeOfWork,
      lineItems: offeredLineItems(solution.lineItems),
      ...(solution.materialAllowanceCents === undefined
        ? {}
        : { materialAllowanceCents: solution.materialAllowanceCents }),
    })),
    terms: offer.terms,
    subtotalCents: offer.subtotalCents,
    taxCents: offer.taxCents,
    totalCents: offer.totalCents,
    ...termsOf(offer),
    ...decision(proposal),
  };
}

// What the paper prints of the customer's answer: the signature and its
// certificate once approved, the day of a decline once declined.
function decision(proposal: Doc<"proposals">): Pick<PaperProposal, "signature" | "declinedAt"> {
  const signature = proposal.signature;
  if (proposal.state === "approved" && signature)
    return {
      signature: {
        signerName: signature.signerName,
        signedAt: signature.signedAt,
        ...(signature.firstOpenedAt === undefined ? {} : { firstOpenedAt: signature.firstOpenedAt }),
        ...(signature.userAgent === undefined ? {} : { userAgent: signature.userAgent }),
        consentWording: signature.consentWording,
        consentWordingVersion: signature.consentWordingVersion,
        noticeShown: signature.noticeShown,
        ...(signature.noticeTicked &&
        signature.noticeWording !== undefined &&
        signature.noticeWordingVersion !== undefined
          ? {
              notice: {
                wording: signature.noticeWording,
                version: signature.noticeWordingVersion,
              },
            }
          : {}),
        fingerprint: signature.sealed.fingerprint,
      },
    };
  if (proposal.state === "declined" && proposal.declinedAt !== undefined)
    return { declinedAt: proposal.declinedAt };
  return {};
}

// The **Estimator**: the signed-in owner, under the name and email on their
// account at this moment, and the gap printed where the account has none.
function estimatorOf(identity: UserIdentity | null): { name: string; email: string } {
  return {
    name: identity?.name?.trim() || Unknown,
    email: identity?.email?.trim() || Unknown,
  };
}

// A draft's solutions as it offers them, read live. An id naming a solution
// since deleted is simply not there.
async function liveSolutions(ctx: QueryCtx, proposal: Doc<"proposals">) {
  return (await Promise.all(proposal.solutionIds.map((id) => ctx.db.get(id)))).flatMap(
    (solution) => (solution ? [solution] : []),
  );
}
