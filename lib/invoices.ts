import { invoiceNumberLabel, type InvoiceLine } from "./invoice-money";
import { PacificTimeZone, type Standing } from "./invoice-standing";
import { panelHref } from "./side-panel";

// How an **Invoice** (CONTEXT.md) reads in the staff app: its row title, the
// one chip it wears, where it opens, and how the Invoices page filters and
// orders it. Pure, so the server's lists and the pages agree on every row.

export type InvoiceKind = "deposit" | "final" | "typed";
export type InvoiceState = "draft" | "sent" | "void";

// The kind as a row names it; a typed invoice goes by the title the owner
// gave it.
export function invoiceKindLabel(kind: InvoiceKind, title?: string | null): string {
  switch (kind) {
    case "deposit":
      return "Deposit";
    case "final":
      return "Final";
    case "typed":
      return title?.trim() || "Invoice";
  }
}

// `INV-1004 · Deposit`, read like a proposal row's `Proposal ID · title`. A
// draft has no number yet, and says so where the number goes.
export function invoiceRowTitle(invoice: {
  number: number | null;
  kind: InvoiceKind;
  title?: string | null;
}): string {
  const number = invoice.number === null ? "Draft" : invoiceNumberLabel(invoice.number);
  return `${number} · ${invoiceKindLabel(invoice.kind, invoice.title)}`;
}

// The one chip beside an invoice: its standing once sent, and otherwise the
// state that means it has none.
export type InvoiceBadge = Standing | "draft" | "void";

export function invoiceBadge(invoice: {
  state: InvoiceState;
  standing: Standing | null;
}): InvoiceBadge {
  if (invoice.state === "sent" && invoice.standing) return invoice.standing;
  return invoice.state === "void" ? "void" : "draft";
}

export function invoiceBadgeLabel(badge: InvoiceBadge): string {
  switch (badge) {
    case "unpaid":
      return "Unpaid";
    case "overdue":
      return "Overdue";
    case "paid":
      return "Paid";
    case "draft":
      return "Draft";
    case "void":
      return "Void";
  }
}

// The search parameter the open invoice rides in on (side-panel.ts), on the
// Invoices tab and on the Proposals tab alike.
export const InvoicePanelParam = "invoice";

// Where a row off the hub opens an invoice: its panel on its Site's Invoices
// tab.
export function invoicePanelHref(siteId: string, invoiceId: string): string {
  return panelHref(`/sites/${siteId}/invoices`, "", InvoicePanelParam, invoiceId);
}

// The staff paper, opened from the panel in a tab of its own.
export function invoicePaperHref(invoiceId: string): string {
  return `/invoices/${invoiceId}/paper`;
}

// The Invoices page's Segmented. Unpaid is everything still owed, the overdue
// with it; drafts and void invoices owe nothing and show only under All.
export type InvoiceFilter = "unpaid" | "overdue" | "paid" | "all";

export const invoiceFilters: { value: InvoiceFilter; label: string }[] = [
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All" },
];

export function matchesInvoiceFilter(
  filter: InvoiceFilter,
  invoice: { standing: Standing | null },
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unpaid":
      return invoice.standing === "unpaid" || invoice.standing === "overdue";
    case "overdue":
    case "paid":
      return invoice.standing === filter;
  }
}

// Overdue first, then unpaid, then everything else, and newest sent first
// within each: the overdue ones are at the top without the newest invoice
// being buried.
export function compareInvoiceRows(x: InvoiceOrderRow, y: InvoiceOrderRow): number {
  return standingRank(x) - standingRank(y) || newestSentFirst(x, y);
}

// The Invoices tab's order, and the page's within each standing. A draft has
// not been sent, and sits where it was made.
export function newestSentFirst(
  x: Pick<InvoiceOrderRow, "sentAt" | "createdAt">,
  y: Pick<InvoiceOrderRow, "sentAt" | "createdAt">,
): number {
  return (y.sentAt ?? y.createdAt) - (x.sentAt ?? x.createdAt) || y.createdAt - x.createdAt;
}

// The Dashboard's Overdue list: the one waited on longest at the top.
export function oldestSentFirst(
  x: Pick<InvoiceOrderRow, "sentAt" | "createdAt">,
  y: Pick<InvoiceOrderRow, "sentAt" | "createdAt">,
): number {
  return newestSentFirst(y, x);
}

type InvoiceOrderRow = {
  standing: Standing | null;
  sentAt: number | null;
  createdAt: number;
};

function standingRank(row: InvoiceOrderRow): number {
  if (row.standing === "overdue") return 0;
  if (row.standing === "unpaid") return 1;
  return 2;
}

// The page's search: the customer, the number and the title, all of which the
// row title and the line under it carry.
export function matchesInvoiceSearch(
  invoice: { customerName: string; title: string },
  search: string,
): boolean {
  const query = search.trim().toLowerCase();
  return `${invoice.customerName} ${invoice.title}`.toLowerCase().includes(query);
}

// When an invoice went out, under its row: the day, in Pacific time as its
// paper dates it. A draft has not gone anywhere yet. The locale is for tests to
// pin.
export function invoiceSentLabel(sentAt: number | null, locale?: string): string {
  if (sentAt === null) return "Not sent yet";
  const day = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: PacificTimeZone,
  }).format(sentAt);
  return `Sent ${day}`;
}

// Why **Send** is refused. Named here rather than on the button because the
// same questions decide it on the server inside `invoices.send`, and the panel
// lists exactly what the mutation would refuse, as a proposal's does.
export type InvoiceSendBlocker = "no_lines" | "blank_line" | "no_email";

// Every reason at once, in the order they read: what the invoice is missing,
// what is wrong with what it holds, then where it would go.
export function invoiceSendBlockers(
  lines: readonly Pick<InvoiceLine, "description">[],
  email: string | null,
): InvoiceSendBlocker[] {
  const blockers: InvoiceSendBlocker[] = [];
  if (lines.length === 0) blockers.push("no_lines");
  if (lines.some((line) => !line.description.trim())) blockers.push("blank_line");
  if (email === null) blockers.push("no_email");
  return blockers;
}

export function invoiceSendBlockerMessage(blocker: InvoiceSendBlocker): string {
  switch (blocker) {
    case "no_lines":
      return "This invoice has no lines.";
    case "blank_line":
      return "A line on this invoice has no description.";
    case "no_email":
      return "The customer has no email address to send it to.";
  }
}

// One **Invoice line** as a draft's table holds it while it is typed in: the
// amount as the field shows it, because "-" on the way to "-80" is a real
// state of the field. `key` is the row's identity on screen; nothing stores it.
export type InvoiceLineDraft = { key: string; description: string; amount: string };

export function lineDraftsFrom(lines: readonly InvoiceLine[]): InvoiceLineDraft[] {
  return lines.map((line, index) => ({
    key: `stored-${index}`,
    description: line.description,
    amount: amountField(line.cents),
  }));
}

// Cents as the field shows them for editing: plain dollars and cents, signed,
// with no currency symbol or grouping to type around. Nothing at all for $0,
// so a fresh line's field is empty.
export function amountField(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toFixed(2);
}

// An amount typed by hand, as whole cents: "$1,250.50", "1250.5" and "-$80"
// all read, and a typographic minus counts as one. Empty is $0. Anything that
// is not an amount yet, "-" mid-keystroke included, is null, and the table
// waits rather than storing a figure nobody typed.
export function readAmountField(raw: string): number | null {
  const typed = raw.trim().replace(/\u2212/g, "-").replace(/[$,\s]/g, "");
  if (typed === "") return 0;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(typed)) return null;
  // Adding 0 turns -0 into 0.
  return Math.round(Number(typed) * 100) + 0;
}

// What the table should be saved as, whole, or `null` for "not yet" while an
// amount cannot be read. A line with no description is kept: it is the
// owner's to write or remove, and Send names it until they do.
export function linesToStore(drafts: readonly InvoiceLineDraft[]): InvoiceLine[] | null {
  const lines: InvoiceLine[] = [];
  for (const draft of drafts) {
    const cents = readAmountField(draft.amount);
    if (cents === null) return null;
    lines.push({ description: draft.description.trim(), cents });
  }
  return lines;
}

// Whether the table still says what the invoice holds. A field left alone is
// not an edit.
export function sameInvoiceLines(
  left: readonly InvoiceLine[],
  right: readonly InvoiceLine[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (line, index) =>
        line.description === right[index].description && line.cents === right[index].cents,
    )
  );
}
