// The app's single door to an email provider, ported from FRSG's
// convex/email.ts without attachments: Expand's emails carry a link and never
// a file. Everything that sends mail goes through `sendEmail`, so the
// provider, the address mail comes from and the rule for a deployment with no
// key are each decided once here.
//
// Nothing throws. A caller gets one of three answers: the mail was sent, this
// deployment does not send mail at all, or something stopped a send that was
// meant to happen and it is named. Every send runs in a scheduled action after
// the mutation that caused it has committed, so an exception here would be an
// unhandled failure nobody sees, and a Send must never depend on Resend being
// up.

import { ExpandBusiness } from "../lib/expand-business";

const ResendEndpoint = "https://api.resend.com/emails";

// Resend rejects a request without one, and Convex's own fetch is not
// promised to add it.
const UserAgent = "expand-handyman/0.1";

// Who the mail comes from: the mailbox verified in Resend, which a deployment
// may override with EMAIL_FROM.
function emailFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || ExpandBusiness.emailFrom;
}

// Where a customer's reply goes: Expand's own mailbox, never the sending
// address, which has no inbox behind it.
export function emailReplyTo(): string {
  return process.env.EMAIL_REPLY_TO?.trim() || ExpandBusiness.email;
}

// Where the web app this mail points back into is served from.
export function appOrigin(): string {
  return process.env.APP_ORIGIN?.trim().replace(/\/+$/, "") ?? "";
}

// Whether this deployment sends mail at all. Asked apart from `sendEmail` by a
// caller that has to decide whether something missing is a fault.
export function sendsEmail(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  // Resend answers a repeat of a key it has seen in the last 24 hours with the
  // first answer and sends nothing, so a retried action cannot double-send.
  idempotencyKey: string;
  // Which letter this is, for Resend's dashboard and any later webhook to
  // route by without a read. ASCII letters, digits, `_` and `-` only.
  tags: Record<string, string>;
};

// Everything that can stop a send this deployment meant to make.
// `HTTP_${number}` carries Resend's own status, so a rejected address (422)
// is told from an outage (503) without a second lookup.
export type EmailFault =
  | "REQUEST_FAILED"
  | "MISSING_FROM_ADDRESS"
  | "MISSING_RECIPIENT"
  | `HTTP_${number}`;

export type EmailResult =
  // Accepted by Resend. A 2xx with no id is still a send.
  | { outcome: "sent"; id: string | null }
  // Nothing was attempted and nothing is wrong: development, CI and previews
  // have no key, so they read their mail in the Convex log instead.
  | { outcome: "notSent"; reason: "noApiKey" }
  | { outcome: "fault"; fault: EmailFault };

// What became of a send, as the schema stores it: a send Resend gave no id
// for keeps no id rather than a null.
export function storedOutcome(result: EmailResult | { outcome: "fault"; fault: string }) {
  return result.outcome === "sent"
    ? { outcome: "sent" as const, ...(result.id === null ? {} : { id: result.id }) }
    : result;
}

// A deployment that sends mail but cannot say where the signing page lives
// has nothing to put in a letter carrying a link. That is a misconfiguration,
// reported the way Resend rejecting the address is.
export const MissingOriginFault = "MISSING_APP_ORIGIN";

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  // Asked first, because it is the only question whose answer is "this
  // deployment does not do email". Past it, everything missing is a fault.
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return logUnsentMessage(message);

  const to = message.to.trim();
  if (!to) {
    console.error(`Email "${message.subject}" not sent: it has no recipient address.`);
    return { outcome: "fault", fault: "MISSING_RECIPIENT" };
  }

  const from = emailFromAddress();
  if (!from) {
    console.error(`Email to ${to} not sent: no from-address is configured (EMAIL_FROM).`);
    return { outcome: "fault", fault: "MISSING_FROM_ADDRESS" };
  }

  let response: Response;
  try {
    response = await fetch(ResendEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
        "User-Agent": UserAgent,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: message.subject,
        text: message.text,
        // Resend's REST field is snake_case; only its SDK spells it replyTo.
        ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
        tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })),
      }),
    });
  } catch {
    console.error(`Email to ${to} failed to reach Resend.`);
    return { outcome: "fault", fault: "REQUEST_FAILED" };
  }

  const body = await readBody(response);

  if (!response.ok) {
    console.error(`Email to ${to} rejected by Resend (${response.status}): ${body ?? "no body"}`);
    return { outcome: "fault", fault: `HTTP_${response.status}` };
  }

  return { outcome: "sent", id: readId(body) };
}

function logUnsentMessage(message: EmailMessage): EmailResult {
  console.log(
    `Email not sent (no Resend key). To: ${message.to.trim() || "<no recipient>"}. Subject: ${message.subject}.\n${message.text}`,
  );
  return { outcome: "notSent", reason: "noApiKey" };
}

async function readBody(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

function readId(body: string | null): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    const id =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).id
        : undefined;
    return typeof id === "string" && id.trim() ? id : null;
  } catch {
    return null;
  }
}
