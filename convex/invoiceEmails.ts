import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  appOrigin,
  emailReplyTo,
  MissingOriginFault,
  sendEmail,
  sendsEmail,
  storedOutcome,
} from "./email";
import { formatCentsExact } from "../lib/money";
import { signingPath, signingUrl } from "../lib/signing-link";

// The **Invoice link** email, the one letter an invoice sends, in the words
// settled on the invoices spec (#93, "Email"): plain text, from the address
// and with the reply-to every proposal letter uses. Scheduled after the
// mutation that sent the invoice has committed, so a Resend outage never
// unsends it; what became of the letter is written to the link.

export const invoiceLinkLetter = {
  linkId: v.id("invoiceLinks"),
  token: v.string(),
  to: v.string(),
  customerName: v.string(),
  // Who the letter says sent it: the proposal's Estimator for the deposit
  // invoice.
  senderName: v.string(),
  // `INV-1001`.
  number: v.string(),
  siteStreet: v.string(),
  // The invoice's first line, which says what it is for.
  firstLine: v.string(),
  amountDueCents: v.number(),
};

export const sendInvoiceLink = internalAction({
  args: invoiceLinkLetter,
  handler: async (ctx, a) => {
    const url = signingUrl(appOrigin(), a.token);
    if (!url && sendsEmail()) {
      console.error(
        `Invoice link for ${a.to} not emailed: no app origin is configured (APP_ORIGIN).`,
      );
      await ctx.runMutation(internal.invoiceLinks.recordEmail, {
        linkId: a.linkId,
        email: { outcome: "fault", fault: MissingOriginFault },
      });
      return;
    }

    const result = await sendEmail({
      to: a.to,
      subject: `Your Expand Handyman invoice for ${a.siteStreet}`,
      text: invoiceLinkBody({ ...a, url: url ?? signingPath(a.token) }),
      replyTo: emailReplyTo(),
      idempotencyKey: `invoice-link/${a.linkId}`,
      tags: { letter: "invoice_link" },
    });

    if (result.outcome === "fault")
      console.error(
        `Invoice link for ${a.to} was not emailed (${result.fault}). The link is live.`,
      );

    await ctx.runMutation(internal.invoiceLinks.recordEmail, {
      linkId: a.linkId,
      email: storedOutcome(result),
    });
  },
});

function invoiceLinkBody(letter: {
  customerName: string;
  senderName: string;
  number: string;
  siteStreet: string;
  firstLine: string;
  amountDueCents: number;
  url: string;
}): string {
  return [
    `Hello ${letter.customerName},`,
    "",
    `${letter.senderName} at Expand Handyman has sent you Invoice ${letter.number} for ${letter.siteStreet}: ${letter.firstLine}, ${formatCentsExact(letter.amountDueCents, "en-US")}. It is due on receipt.`,
    "",
    "See it and how to pay here:",
    letter.url,
    "",
    "This link is yours alone. Reply to this email with any questions.",
  ].join("\n");
}
