import { invoiceNumberLabel } from "./invoice-money";
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

// Where a row off the hub opens an invoice: its panel on the customer's
// Invoices tab.
export function invoicePanelHref(customerId: string, invoiceId: string): string {
  return panelHref(`/customers/${customerId}/invoices`, "", InvoicePanelParam, invoiceId);
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
