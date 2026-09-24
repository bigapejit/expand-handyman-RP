import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  appOrigin,
  emailReplyTo,
  MissingOriginFault,
  sendEmail,
  sendsEmail,
  storedOutcome,
  type EmailResult,
} from "./email";
import { formatCents } from "../lib/money";
import { signingPath, signingUrl } from "../lib/signing-link";

// The emails a proposal sends on its way through the lifecycle, ported from
// FRSG's convex/proposalEmails.ts without attachments. This file is what
// Expand says; everything about Resend stays behind email.ts's `sendEmail`.
// The texts are the ones settled on "Decide the proposal lifecycle, signing
// link and email texts for one recipient" (#17).
//
// Every one runs scheduled, after the mutation that caused it has committed:
// Send is the offer and is live the moment its mutation lands, so a Resend
// outage must be able to fail without unmaking it. Nothing here throws. What
// became of the email is written back onto the signing link, and the panel
// offers the link to copy when it did not go.

export const signingLinkLetter = {
  linkId: v.id("signingLinks"),
  token: v.string(),
  to: v.string(),
  customerName: v.string(),
  // The owner sending it, from their sign-in account's profile.
  ownerName: v.string(),
  siteStreet: v.string(),
  siteAddress: v.string(),
  proposalTitle: v.string(),
  totalCents: v.number(),
};

export const sendSigningLink = internalAction({
  args: signingLinkLetter,
  handler: async (ctx, a) => {
    const url = signingUrl(appOrigin(), a.token);
    if (!url && sendsEmail()) {
      console.error(
        `Signing link for ${a.to} not emailed: no app origin is configured (APP_ORIGIN).`,
      );
      await ctx.runMutation(internal.signingLinks.recordEmail, {
        linkId: a.linkId,
        email: { outcome: "fault", fault: MissingOriginFault },
      });
      return;
    }

    const result = await sendEmail({
      to: a.to,
      subject: `Your Expand Handyman proposal for ${a.siteStreet}`,
      // With no key the letter only reaches the log, where the path still
      // says which link it was.
      text: signingLinkBody({ ...a, url: url ?? signingPath(a.token) }),
      replyTo: emailReplyTo(),
      idempotencyKey: `signing-link/${a.linkId}`,
      tags: { letter: "signing_link" },
    });

    if (result.outcome === "fault")
      console.error(
        `Signing link for ${a.to} was not emailed (${result.fault}). The link is live and can be copied from the proposal.`,
      );

    await ctx.runMutation(internal.signingLinks.recordEmail, {
      linkId: a.linkId,
      email: storedOutcome(result),
    });
  },
});

function signingLinkBody(letter: {
  customerName: string;
  ownerName: string;
  siteAddress: string;
  proposalTitle: string;
  totalCents: number;
  url: string;
}): string {
  return [
    `Hello ${letter.customerName},`,
    "",
    `${letter.ownerName} at Expand Handyman has sent you a proposal for ${letter.siteAddress}: ${letter.proposalTitle}, ${formatCents(letter.totalCents, "en-US")}.`,
    "",
    "Read it and approve or decline it here:",
    letter.url,
    "",
    "This link is yours alone. Reply to this email with any questions.",
  ].join("\n");
}

// Where a decision's email says what became of it: the proposal's own list of
// the letters its decision sent, by the place each was given when scheduled.
async function recordDecision(
  ctx: ActionCtx,
  letter: { proposalId: Id<"proposals">; index: number },
  result: EmailResult | { outcome: "fault"; fault: string },
) {
  await ctx.runMutation(internal.proposals.recordDecisionEmail, {
    proposalId: letter.proposalId,
    index: letter.index,
    email: storedOutcome(result),
  });
}

export const approvalLetter = {
  proposalId: v.id("proposals"),
  // Its place among the decision's emails, and where it goes: the customer's
  // and Expand's copies are the same letter, sent on their own.
  index: v.number(),
  to: v.string(),
  token: v.string(),
  signerName: v.string(),
  code: v.string(),
  siteStreet: v.string(),
  siteAddress: v.string(),
  signedAt: v.number(),
  proposalTitle: v.string(),
  totalCents: v.number(),
};

// The approval notice, pointing at the signing link, which shows the signed
// copy from now on.
export const sendApproval = internalAction({
  args: approvalLetter,
  handler: async (ctx, a) => {
    const url = signingUrl(appOrigin(), a.token);
    if (!url && sendsEmail()) {
      console.error(`Approval notice for ${a.to} not emailed: no app origin is configured (APP_ORIGIN).`);
      await recordDecision(ctx, a, { outcome: "fault", fault: MissingOriginFault });
      return;
    }

    const result = await sendEmail({
      to: a.to,
      subject: `Signed: Expand Handyman proposal for ${a.siteStreet}`,
      text: [
        `${a.signerName} accepted Proposal ${a.code} for ${a.siteAddress} on ${pacificDate(a.signedAt)}: ${a.proposalTitle}, ${formatCents(a.totalCents, "en-US")}.`,
        "",
        "The signed copy, with the terms as accepted, is here:",
        url ?? signingPath(a.token),
        "",
        "Keep this email as your record of the agreement. Expand Handyman will be in touch about the next steps.",
      ].join("\n"),
      replyTo: emailReplyTo(),
      idempotencyKey: `approval/${a.proposalId}/${a.index}`,
      tags: { letter: "approval" },
    });
    if (result.outcome === "fault")
      console.error(`Approval notice for ${a.to} was not emailed (${result.fault}).`);
    await recordDecision(ctx, a, result);
  },
});

export const declineLetter = {
  proposalId: v.id("proposals"),
  index: v.number(),
  to: v.string(),
  customerName: v.string(),
  code: v.string(),
  siteStreet: v.string(),
  siteAddress: v.string(),
  proposalTitle: v.string(),
  reason: v.optional(v.string()),
};

// The decline notice, to Expand only: the customer gets no confirmation.
export const sendDeclineNotice = internalAction({
  args: declineLetter,
  handler: async (ctx, a) => {
    const result = await sendEmail({
      to: a.to,
      subject: `Declined: Proposal ${a.code} for ${a.siteStreet}`,
      text: [
        `${a.customerName} declined Proposal ${a.code} for ${a.siteAddress}: ${a.proposalTitle}.`,
        "",
        a.reason === undefined ? "They gave no reason." : `Their reason: ${a.reason}`,
      ].join("\n"),
      replyTo: emailReplyTo(),
      idempotencyKey: `decline/${a.proposalId}/${a.index}`,
      tags: { letter: "decline_notice" },
    });
    if (result.outcome === "fault")
      console.error(`Decline notice for ${a.to} was not emailed (${result.fault}).`);
    await recordDecision(ctx, a, result);
  },
});

// A day as the emails date one: in Pacific time, where Expand and its
// customers are, written out so it cannot be read month-first or day-first.
function pacificDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(ms);
}
