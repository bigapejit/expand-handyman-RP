import { describe, expect, it } from "vitest";

import {
  ago,
  proposalBoard,
  type BoardInputs,
  type BoardInvoice,
  type BoardProposal,
} from "./proposal-board";

const Day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-19T18:00:00Z");

function proposal(id: string, patch: Partial<BoardProposal> = {}): BoardProposal {
  return {
    proposalId: id,
    siteId: `site-${id}`,
    customerId: `customer-${id}`,
    customerName: `Customer ${id}`,
    code: `1215MAIN-P${id}`,
    title: "Replace rotted deck boards",
    state: "draft",
    totalCents: 100_000,
    ...patch,
  };
}

function invoice(proposalId: string, patch: Partial<BoardInvoice> = {}): BoardInvoice {
  return {
    proposalId,
    kind: "deposit",
    state: "sent",
    standing: "unpaid",
    amountDueCents: 50_000,
    createdAt: now - 10 * Day,
    ...patch,
  };
}

function board(patch: Partial<BoardInputs>) {
  return proposalBoard(
    { proposals: [], sites: [], sent: [], decided: [], invoices: [], ...patch },
    now,
  );
}

function column(result: ReturnType<typeof board>, key: string) {
  const found = result.columns.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No column ${key}`);
  return found;
}

// The one approved proposal "a", with the given invoices, as its board row.
function approvedRow(invoices: Partial<BoardInvoice>[], decidedAt = now - 3 * Day) {
  const result = board({
    proposals: [proposal("a", { state: "approved" })],
    decided: [{ proposalId: "a", decidedAt }],
    invoices: invoices.map((patch) => invoice("a", patch)),
  });
  const row = result.columns.flatMap((held) => held.rows)[0];
  if (!row) throw new Error("No row");
  return row;
}

describe("The board's columns", () => {
  it("are always the four, left to right in the order a job moves", () => {
    expect(board({}).columns.map((held) => held.title)).toEqual([
      "Drafts",
      "With customer",
      "Approved · to do",
      "Done & declined",
    ]);
  });

  it("put each proposal in the column its state says", () => {
    const result = board({
      proposals: [
        proposal("d", { state: "draft" }),
        proposal("s", { state: "sent" }),
        proposal("a", { state: "approved" }),
        proposal("x", { state: "declined" }),
      ],
    });
    expect(result.columns.map((held) => held.rows.map((row) => row.proposalId))).toEqual([
      ["d"],
      ["s"],
      ["a"],
      ["x"],
    ]);
  });

  it("count each column's total in whole cents, and show it only for money in play", () => {
    const result = board({
      proposals: [
        proposal("s1", { state: "sent", totalCents: 71_090 }),
        proposal("s2", { state: "sent", totalCents: 44_550 }),
        proposal("d", { state: "draft", totalCents: 99_999 }),
      ],
    });
    expect(column(result, "with_customer").totalCents).toBe(115_640);
    expect(column(result, "with_customer").showsTotal).toBe(true);
    expect(column(result, "draft").showsTotal).toBe(false);
    expect(column(result, "done").showsTotal).toBe(false);
  });

  it("put each job's street beside it, and nothing when its site is gone", () => {
    const result = board({
      proposals: [proposal("a"), proposal("b")],
      sites: [{ siteId: "site-a", streetLine: "1215 Main St" }],
    });
    const rows = column(result, "draft").rows;
    expect(rows.find((row) => row.proposalId === "a")?.street).toBe("1215 Main St");
    expect(rows.find((row) => row.proposalId === "b")?.street).toBe("");
  });
});

describe("A draft", () => {
  it("says it has not gone, or that it has no price to send yet", () => {
    const result = board({
      proposals: [proposal("priced"), proposal("empty", { totalCents: 0 })],
    });
    const hints = column(result, "draft").rows.map((row) => [row.proposalId, row.hint]);
    expect(hints).toEqual([
      ["priced", "Not sent yet"],
      ["empty", "No price yet"],
    ]);
  });

  it("keeps the newest-first order the list came in", () => {
    const result = board({ proposals: [proposal("3"), proposal("2"), proposal("1")] });
    expect(column(result, "draft").rows.map((row) => row.proposalId)).toEqual(["3", "2", "1"]);
  });
});

describe("A proposal with the customer", () => {
  it("says whether it was opened and how long ago it went", () => {
    const result = board({
      proposals: [
        proposal("never", { state: "sent" }),
        proposal("once", { state: "sent" }),
        proposal("thrice", { state: "sent" }),
      ],
      sent: [
        { proposalId: "never", sentAt: now - 2 * Day, customerViews: 0 },
        { proposalId: "once", sentAt: now - Day, customerViews: 1 },
        { proposalId: "thrice", sentAt: now - 3 * Day, customerViews: 3 },
      ],
    });
    const hintOf = (id: string) =>
      column(result, "with_customer").rows.find((row) => row.proposalId === id)?.hint;
    expect(hintOf("never")).toBe("Not opened yet · sent 2 days ago");
    expect(hintOf("once")).toBe("Viewed once · sent yesterday");
    expect(hintOf("thrice")).toBe("Viewed 3× · sent 3 days ago");
  });

  it("gets the amber dot only when unopened for five days or more", () => {
    const result = board({
      proposals: [
        proposal("fresh", { state: "sent" }),
        proposal("stale", { state: "sent" }),
        proposal("read", { state: "sent" }),
      ],
      sent: [
        { proposalId: "fresh", sentAt: now - 4 * Day, customerViews: 0 },
        { proposalId: "stale", sentAt: now - 5 * Day, customerViews: 0 },
        { proposalId: "read", sentAt: now - 20 * Day, customerViews: 2 },
      ],
    });
    const toneOf = (id: string) =>
      column(result, "with_customer").rows.find((row) => row.proposalId === id)?.tone;
    expect(toneOf("fresh")).toBe("quiet");
    expect(toneOf("stale")).toBe("nudge");
    expect(toneOf("read")).toBe("quiet");
  });

  it("puts the one waiting longest at the top", () => {
    const result = board({
      proposals: [
        proposal("new", { state: "sent" }),
        proposal("old", { state: "sent" }),
        proposal("mid", { state: "sent" }),
      ],
      sent: [
        { proposalId: "new", sentAt: now - Day, customerViews: 0 },
        { proposalId: "old", sentAt: now - 9 * Day, customerViews: 0 },
        { proposalId: "mid", sentAt: now - 4 * Day, customerViews: 0 },
      ],
    });
    expect(column(result, "with_customer").rows.map((row) => row.proposalId)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("reads as just sent when the sent list has not caught up with it", () => {
    const result = board({ proposals: [proposal("s", { state: "sent" })] });
    expect(column(result, "with_customer").rows[0]?.hint).toBe("Not opened yet · sent today");
  });
});

describe("An approved proposal", () => {
  it("says late money first, in red, whatever else is going on", () => {
    const row = approvedRow([
      { standing: "overdue", amountDueCents: 44_550 },
      { kind: "final", state: "draft", standing: null },
    ]);
    expect([row.hint, row.tone, row.column]).toEqual(["$445.50 overdue", "late", "approved"]);
  });

  it("says when an invoice is written and not sent", () => {
    expect(approvedRow([{ kind: "final", state: "draft", standing: null }]).hint).toBe(
      "Final invoice written, not sent",
    );
    expect(approvedRow([{ kind: "typed", state: "draft", standing: null }]).hint).toBe(
      "Invoice written, not sent",
    );
  });

  it("says an unpaid deposit, or one whose bank payment is on its way", () => {
    expect(approvedRow([{ standing: "unpaid", amountDueCents: 50_000 }]).hint).toBe(
      "Deposit $500 not paid yet",
    );
    expect(approvedRow([{ standing: "on_its_way" }]).hint).toBe("Deposit on its way");
  });

  it("is work to do, in green, once the deposit is paid", () => {
    const row = approvedRow([{ standing: "paid" }]);
    expect([row.hint, row.tone]).toEqual(["Deposit paid · work to do", "good"]);
  });

  it("says when it was approved when there is no deposit", () => {
    expect(approvedRow([]).hint).toBe("Approved 3 days ago · no deposit");
    // A voided deposit invoice was a mistake taken back; it says nothing.
    expect(approvedRow([{ state: "void", standing: null }]).hint).toBe(
      "Approved 3 days ago · no deposit",
    );
  });

  it("says what is still to come once the final invoice is out", () => {
    const row = approvedRow([
      { standing: "paid" },
      { kind: "final", standing: "unpaid", amountDueCents: 123_456 },
    ]);
    expect(row.hint).toBe("Final invoice sent · $1,234.56 to come");
  });

  it("says a typed invoice not paid yet before the deposit is billed", () => {
    expect(
      approvedRow([{ kind: "typed", standing: "unpaid", amountDueCents: 20_000 }]).hint,
    ).toBe("$200 invoiced, not paid yet");
  });

  it("moves to Done once the final invoice is sent and everything is paid", () => {
    const row = approvedRow([{ standing: "paid" }, { kind: "final", standing: "paid" }]);
    expect([row.column, row.hint, row.tone]).toEqual(["done", "Paid in full", "good"]);
  });

  it("sits higher the more it needs the owner", () => {
    const result = board({
      proposals: [
        proposal("waiting", { state: "approved" }),
        proposal("work", { state: "approved" }),
        proposal("late", { state: "approved" }),
        proposal("unsent", { state: "approved" }),
      ],
      invoices: [
        invoice("waiting", { standing: "unpaid" }),
        invoice("work", { standing: "paid" }),
        invoice("late", { standing: "overdue" }),
        invoice("unsent", { kind: "final", state: "draft", standing: null }),
      ],
    });
    expect(column(result, "approved").rows.map((row) => row.proposalId)).toEqual([
      "late",
      "unsent",
      "work",
      "waiting",
    ]);
  });
});

describe("A declined proposal", () => {
  it("says when, and sorts the latest answer first", () => {
    const result = board({
      proposals: [
        proposal("early", { state: "declined" }),
        proposal("late", { state: "declined" }),
        proposal("unknown", { state: "declined" }),
      ],
      decided: [
        { proposalId: "early", decidedAt: now - 30 * Day },
        { proposalId: "late", decidedAt: now - 2 * Day },
      ],
    });
    expect(column(result, "done").rows.map((row) => [row.proposalId, row.hint])).toEqual([
      ["late", "Declined 2 days ago"],
      ["early", "Declined 4 weeks ago"],
      ["unknown", "Declined"],
    ]);
  });
});

describe("What customers owe", () => {
  it("adds up every sent invoice not yet paid, and the overdue part of it", () => {
    const result = board({
      invoices: [
        invoice("a", { standing: "unpaid", amountDueCents: 10_000 }),
        invoice("a", { standing: "overdue", amountDueCents: 44_550 }),
        invoice("b", { standing: "on_its_way", amountDueCents: 5_000 }),
        invoice("b", { standing: "paid", amountDueCents: 99_999 }),
        invoice("c", { state: "draft", standing: null, amountDueCents: 77_777 }),
        invoice("c", { state: "void", standing: null, amountDueCents: 66_666 }),
      ],
    });
    expect(result.owedCents).toBe(59_550);
    expect(result.lateCents).toBe(44_550);
  });
});

describe("How long ago", () => {
  it("reads as a person would say it", () => {
    expect(ago(now - 60_000, now)).toBe("today");
    expect(ago(now - Day, now)).toBe("yesterday");
    expect(ago(now - 13 * Day, now)).toBe("13 days ago");
    expect(ago(now - 14 * Day, now)).toBe("2 weeks ago");
    expect(ago(now - 90 * Day, now)).toBe("3 months ago");
  });
});
