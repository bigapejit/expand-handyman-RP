import { describe, expect, it } from "vitest";

import {
  compareInvoiceRows,
  invoiceBadge,
  invoiceBadgeLabel,
  invoiceKindLabel,
  invoicePanelHref,
  invoicePaperHref,
  invoiceRowTitle,
  invoiceSentLabel,
  matchesInvoiceFilter,
  matchesInvoiceSearch,
  type InvoiceState,
} from "./invoices";

describe("How an invoice is named on a row", () => {
  it("reads its number and its kind", () => {
    expect(invoiceRowTitle({ number: 1004, kind: "deposit" })).toBe("INV-1004 · Deposit");
    expect(invoiceRowTitle({ number: 1007, kind: "final" })).toBe("INV-1007 · Final");
  });

  it("names a typed invoice by its title, and says Draft where a draft has no number", () => {
    expect(invoiceRowTitle({ number: 1005, kind: "typed", title: "Framing midway" })).toBe(
      "INV-1005 · Framing midway",
    );
    expect(invoiceRowTitle({ number: null, kind: "final" })).toBe("Draft · Final");
  });

  it("calls an untitled typed invoice an Invoice", () => {
    expect(invoiceKindLabel("typed")).toBe("Invoice");
    expect(invoiceKindLabel("typed", "  ")).toBe("Invoice");
  });
});

describe("Where an invoice opens", () => {
  it("opens its panel on its customer's Invoices tab", () => {
    expect(invoicePanelHref("c1", "i9")).toBe("/customers/c1/invoices?invoice=i9");
  });

  it("opens the staff paper on a page of its own", () => {
    expect(invoicePaperHref("i9")).toBe("/invoices/i9/paper");
  });
});

describe("The chip a row wears", () => {
  it("is the standing of a sent invoice, and Draft or Void otherwise", () => {
    expect(invoiceBadge({ state: "sent", standing: "overdue" })).toBe("overdue");
    expect(invoiceBadge({ state: "draft", standing: null })).toBe("draft");
    expect(invoiceBadge({ state: "void", standing: null })).toBe("void");
    expect(["unpaid", "overdue", "paid", "draft", "void"].map((b) => invoiceBadgeLabel(b as never))).toEqual([
      "Unpaid",
      "Overdue",
      "Paid",
      "Draft",
      "Void",
    ]);
  });
});

type Row = Parameters<typeof compareInvoiceRows>[0] & { state: InvoiceState };
const row = (over: Partial<Row> & { id: string }): Row & { id: string } => ({
  state: "sent",
  standing: "unpaid",
  sentAt: 0,
  createdAt: 0,
  ...over,
});

describe("The Invoices page's filters", () => {
  const overdue = row({ id: "o", standing: "overdue" });
  const unpaid = row({ id: "u" });
  const paid = row({ id: "p", standing: "paid" });
  const draft = row({ id: "d", state: "draft", standing: null, sentAt: null });
  const voided = row({ id: "v", state: "void", standing: null });
  const all = [overdue, unpaid, paid, draft, voided];
  const shown = (filter: Parameters<typeof matchesInvoiceFilter>[0]) =>
    all.filter((r) => matchesInvoiceFilter(filter, r)).map((r) => r.id);

  it("counts an overdue invoice as unpaid too: Unpaid is everything still owed", () => {
    expect(shown("unpaid")).toEqual(["o", "u"]);
    expect(shown("overdue")).toEqual(["o"]);
    expect(shown("paid")).toEqual(["p"]);
  });

  it("shows drafts and void invoices only under All", () => {
    expect(shown("all")).toEqual(["o", "u", "p", "d", "v"]);
  });
});

describe("The Invoices page's order", () => {
  it("puts overdue first, then unpaid, then the rest, newest sent first within each", () => {
    const rows = [
      row({ id: "paid-new", standing: "paid", sentAt: 900 }),
      row({ id: "unpaid-old", sentAt: 100 }),
      row({ id: "overdue-old", standing: "overdue", sentAt: 10 }),
      row({ id: "unpaid-new", sentAt: 500 }),
      row({ id: "void", state: "void", standing: null, sentAt: 800 }),
      row({ id: "overdue-new", standing: "overdue", sentAt: 50 }),
      row({ id: "draft", state: "draft", standing: null, sentAt: null, createdAt: 850 }),
    ];
    expect(rows.sort(compareInvoiceRows).map((r) => r.id)).toEqual([
      "overdue-new",
      "overdue-old",
      "unpaid-new",
      "unpaid-old",
      "paid-new",
      "draft",
      "void",
    ]);
  });

  it("breaks a tie on the sent moment by which was made last", () => {
    const rows = [
      row({ id: "first", sentAt: 100, createdAt: 1 }),
      row({ id: "second", sentAt: 100, createdAt: 2 }),
    ];
    expect(rows.sort(compareInvoiceRows).map((r) => r.id)).toEqual(["second", "first"]);
  });
});

describe("Searching invoices", () => {
  const found = {
    customerName: "Maria Delgado",
    title: "INV-1004 · Framing midway",
  };

  it("reads the customer, the number and the title, in any case", () => {
    expect(matchesInvoiceSearch(found, "maria")).toBe(true);
    expect(matchesInvoiceSearch(found, "inv-1004")).toBe(true);
    expect(matchesInvoiceSearch(found, "1004")).toBe(true);
    expect(matchesInvoiceSearch(found, "FRAMING")).toBe(true);
    expect(matchesInvoiceSearch(found, "  ")).toBe(true);
    expect(matchesInvoiceSearch(found, "roof")).toBe(false);
  });
});

describe("When a row says it went out", () => {
  it("dates it in Pacific time, and says so when it has not", () => {
    // 8:30pm Pacific on 23 September, already the 24th in UTC.
    expect(invoiceSentLabel(Date.UTC(2026, 8, 24, 3, 30), "en-US")).toBe("Sent Sep 23, 2026");
    expect(invoiceSentLabel(null, "en-US")).toBe("Not sent yet");
  });
});
