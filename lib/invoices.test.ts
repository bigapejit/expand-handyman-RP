import { describe, expect, it } from "vitest";

import {
  amountField,
  compareInvoiceRows,
  invoiceBadge,
  invoiceBadgeLabel,
  invoiceKindLabel,
  invoicePanelHref,
  invoicePaperHref,
  invoiceRowTitle,
  invoiceSendBlockerMessage,
  invoiceSendBlockers,
  invoiceSentLabel,
  lineDraftsFrom,
  linesToStore,
  matchesInvoiceFilter,
  matchesInvoiceSearch,
  readAmountField,
  sameInvoiceLines,
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
  it("opens its panel on its site's Invoices tab", () => {
    expect(invoicePanelHref("s1", "i9")).toBe("/sites/s1/invoices?invoice=i9");
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
    expect(invoiceBadge({ state: "sent", standing: "on_its_way" })).toBe("on_its_way");
    expect(["unpaid", "overdue", "on_its_way", "paid", "draft", "void"].map((b) => invoiceBadgeLabel(b as never))).toEqual([
      "Unpaid",
      "Overdue",
      "Payment on its way",
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
  const onItsWay = row({ id: "w", standing: "on_its_way" });
  const paid = row({ id: "p", standing: "paid" });
  const draft = row({ id: "d", state: "draft", standing: null, sentAt: null });
  const voided = row({ id: "v", state: "void", standing: null });
  const all = [overdue, unpaid, onItsWay, paid, draft, voided];
  const shown = (filter: Parameters<typeof matchesInvoiceFilter>[0]) =>
    all.filter((r) => matchesInvoiceFilter(filter, r)).map((r) => r.id);

  it("counts overdue invoices and payments on their way as unpaid too: Unpaid is everything still owed", () => {
    expect(shown("unpaid")).toEqual(["o", "u", "w"]);
    expect(shown("overdue")).toEqual(["o"]);
    expect(shown("paid")).toEqual(["p"]);
  });

  it("shows drafts and void invoices only under All", () => {
    expect(shown("all")).toEqual(["o", "u", "w", "p", "d", "v"]);
  });
});

describe("The Invoices page's order", () => {
  it("puts overdue first, then unpaid with payments on their way among them, then the rest, newest sent first within each", () => {
    const rows = [
      row({ id: "paid-new", standing: "paid", sentAt: 900 }),
      row({ id: "unpaid-old", sentAt: 100 }),
      row({ id: "overdue-old", standing: "overdue", sentAt: 10 }),
      row({ id: "unpaid-new", sentAt: 500 }),
      row({ id: "void", state: "void", standing: null, sentAt: 800 }),
      row({ id: "overdue-new", standing: "overdue", sentAt: 50 }),
      row({ id: "draft", state: "draft", standing: null, sentAt: null, createdAt: 850 }),
      row({ id: "on-its-way", standing: "on_its_way", sentAt: 300 }),
    ];
    expect(rows.sort(compareInvoiceRows).map((r) => r.id)).toEqual([
      "overdue-new",
      "overdue-old",
      "unpaid-new",
      "on-its-way",
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

describe("Why an invoice cannot be sent yet", () => {
  const line = { description: "Fix gate", cents: 55_000 };

  it("is nothing for a draft with written lines and a customer with an email", () => {
    expect(invoiceSendBlockers([line], "maria@example.com")).toEqual([]);
  });

  it("names every reason at once, in the order they read", () => {
    expect(invoiceSendBlockers([], null)).toEqual(["no_lines", "no_email"]);
    expect(invoiceSendBlockers([line, { description: "  ", cents: 0 }], null)).toEqual([
      "blank_line",
      "no_email",
    ]);
  });

  it("says each in a sentence", () => {
    expect(invoiceSendBlockerMessage("no_lines")).toBe("This invoice has no lines.");
    expect(invoiceSendBlockerMessage("blank_line")).toBe(
      "A line on this invoice has no description.",
    );
    expect(invoiceSendBlockerMessage("no_email")).toBe(
      "The customer has no email address to send it to.",
    );
  });
});

describe("A draft's lines as the panel edits them", () => {
  it("shows each amount as plain dollars to type into, and nothing for $0", () => {
    expect(
      lineDraftsFrom([
        { description: "Fix gate", cents: 123_456 },
        { description: "Less deposit invoiced (INV-1001)", cents: -8_000 },
        { description: "", cents: 0 },
      ]),
    ).toEqual([
      { key: "stored-0", description: "Fix gate", amount: "1234.56" },
      { key: "stored-1", description: "Less deposit invoiced (INV-1001)", amount: "-80.00" },
      { key: "stored-2", description: "", amount: "" },
    ]);
    expect(amountField(5)).toBe("0.05");
  });

  it("reads an amount typed with the punctuation people type around money", () => {
    expect(readAmountField("$1,250.50")).toBe(125_050);
    expect(readAmountField(" 80 ")).toBe(8_000);
    expect(readAmountField("-80")).toBe(-8_000);
    expect(readAmountField("-$80.25")).toBe(-8_025);
    expect(readAmountField("\u221280")).toBe(-8_000);
    expect(readAmountField("")).toBe(0);
  });

  it("reads nothing from what is not an amount yet", () => {
    expect(readAmountField("-")).toBeNull();
    expect(readAmountField("abc")).toBeNull();
    expect(readAmountField("1.2.3")).toBeNull();
  });

  it("stores the table whole, descriptions trimmed, or nothing while an amount is unreadable", () => {
    expect(
      linesToStore([
        { key: "a", description: " Fix gate ", amount: "550" },
        { key: "b", description: "", amount: "" },
      ]),
    ).toEqual([
      { description: "Fix gate", cents: 55_000 },
      { description: "", cents: 0 },
    ]);
    expect(linesToStore([{ key: "a", description: "Fix gate", amount: "five" }])).toBeNull();
  });

  it("knows when the table says what the invoice already holds", () => {
    const stored = [{ description: "Fix gate", cents: 55_000 }];
    expect(sameInvoiceLines(stored, [{ description: "Fix gate", cents: 55_000 }])).toBe(true);
    expect(sameInvoiceLines(stored, [{ description: "Fix gate", cents: 55_001 }])).toBe(false);
    expect(sameInvoiceLines(stored, [])).toBe(false);
  });
});
