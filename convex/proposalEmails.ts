import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { appOrigin, emailReplyTo, sendEmail, sendsEmail } from "./email";
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

// A deployment that sends mail but cannot say where the signing page lives
// has nothing to put in the letter. That is a misconfiguration, reported the
// way Resend rejecting the address is.
const MissingOriginFault = "MISSING_APP_ORIGIN";

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
      email:
        result.outcome === "sent"
          ? { outcome: "sent", ...(result.id === null ? {} : { id: result.id }) }
          : result,
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
