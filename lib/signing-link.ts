// Where a customer opens a **Signing link** (CONTEXT.md). Documents and
// proposals share the one `/sign/<token>` address, so every link from Expand
// looks the same; the page asks Convex which of the two a token belongs to.
// Named once here so the link the panel copies and the link the email carries
// are the same string, character for character.

const SigningPrefix = "/sign";

export function signingPath(token: string): string {
  return `${SigningPrefix}/${encodeURIComponent(token)}`;
}

// The absolute address, or null where there is no origin to put in front of
// the path: the server has no browser to ask, so a deployment that sends mail
// has to name its own (APP_ORIGIN).
export function signingUrl(origin: string | null | undefined, token: string): string | null {
  const base = origin?.trim().replace(/\/+$/, "");
  return base ? `${base}${signingPath(token)}` : null;
}

// What ended a proposal's signing link. Each is something that happened to the
// proposal, and the panel's link history says which.
export type SigningLinkEndedReason = "approved" | "declined" | "withdrawn" | "resent";

export function endedReasonLabel(reason: SigningLinkEndedReason): string {
  switch (reason) {
    case "approved":
      return "Ended: approved";
    case "declined":
      return "Ended: declined";
    case "withdrawn":
      return "Ended: withdrawn";
    case "resent":
      return "Ended: replaced by a re-send";
  }
}

// A signing link's email as the panel reads it. `pending` is the moment
// between Send committing and the scheduled send writing back.
export type LinkEmail =
  | { outcome: "sent"; id?: string }
  | { outcome: "notSent"; reason: "noApiKey" }
  | { outcome: "fault"; fault: string };

export function linkEmailLabel(email: LinkEmail | null): string {
  if (email === null) return "Sending email…";
  switch (email.outcome) {
    case "sent":
      return "Email sent";
    case "notSent":
      return "Email not sent (this deployment sends no mail)";
    case "fault":
      return `Email not sent (${email.fault})`;
  }
}

// Whether the owner has to hand the link over themselves.
export function emailFailed(email: LinkEmail | null): boolean {
  return email !== null && email.outcome !== "sent";
}
