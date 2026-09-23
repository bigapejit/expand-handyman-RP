// An invoice's **Standing** (CONTEXT.md): what it reads about its money,
// worked out each time from its state, its payment, its amount due, the day it
// was sent and today, and never stored, so it can never drift. The rule is
// the invoices spec's (#93, "Money: Standing"):
//
// - a draft or a void invoice has none;
// - one with a payment recorded, or with nothing due, is Paid;
// - one still unpaid more than seven full days after the day it was sent is
//   Overdue: sent on the 1st, it reads Overdue from the 9th;
// - anything else sent is Unpaid, a credit included, until it is marked paid.
//
// Days are Pacific calendar days, where Expand and its customers are, so the
// boundary falls at Pacific midnight whatever the server's clock, and a
// daylight-time change in between moves nothing.

export type Standing = "unpaid" | "overdue" | "paid";

// Days past the sent day an unpaid invoice may run before it reads Overdue.
export const OverdueAfterDays = 7;

const PacificTimeZone = "America/Los_Angeles";

const dayParts = new Intl.DateTimeFormat("en-US", {
  timeZone: PacificTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// A moment's calendar day in Pacific time, as `YYYY-MM-DD`: the form a
// payment's day is stored in, and what the lists are asked about.
export function pacificDay(ms: number): string {
  const parts = Object.fromEntries(
    dayParts.formatToParts(new Date(ms)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Whether a string is a real calendar day written `YYYY-MM-DD`.
export function isPacificDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const at = dayNumber(day);
  return new Date(at * DayMs).toISOString().slice(0, 10) === day;
}

export function invoiceStanding(
  invoice: {
    state: "draft" | "sent" | "void";
    // When Send went out. Every sent or void invoice has one.
    sentAt?: number | null;
    amountDueCents: number;
    // Whether a payment is recorded on it.
    paid: boolean;
  },
  // Today, as `pacificDay` writes it.
  today: string,
): Standing | null {
  if (invoice.state !== "sent") return null;
  if (invoice.paid || invoice.amountDueCents === 0) return "paid";
  if (invoice.sentAt === undefined || invoice.sentAt === null) return "unpaid";
  const daysSinceSent = dayNumber(today) - dayNumber(pacificDay(invoice.sentAt));
  return daysSinceSent > OverdueAfterDays ? "overdue" : "unpaid";
}

const DayMs = 24 * 60 * 60 * 1000;

// A calendar day as a count of days, so two of them subtract to the number of
// midnights between, whatever the clocks did in between.
function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / DayMs;
}
