import type { Standing } from "./invoice-standing";
import type { InvoiceKind, InvoiceState } from "./invoices";
import { formatCents } from "./money";
import type { ProposalState } from "./proposals";

// The **Proposal board** (CONTEXT.md): the home page, every proposal in one of
// four columns by how far the job has got, each with one plain hint saying
// what it is waiting on. The owner thinks in proposals and not in sites,
// customers or invoices, so this is where he starts the day: what to finish,
// what is out with a customer, what is approved and still to do, and what is
// over.
//
// Pure, so the sorting and every hint are tested without Convex. The page
// stitches together queries that already exist (proposals.list,
// proposals.dashboard, sites.list, invoices.list) and hands the rows here;
// the types below are only as wide as this module reads, so any of those
// rows fits.

export type BoardColumnKey = "draft" | "with_customer" | "approved" | "done";

// How loud a hint is. Most are quiet. Colour is kept for the few things worth
// a glance from across the room: money that is late (red), a proposal the
// customer has not even opened after days (amber), and a job paid or ready to
// work (green).
export type HintTone = "quiet" | "good" | "nudge" | "late";

export type BoardProposal = {
  proposalId: string;
  siteId: string;
  customerId: string;
  customerName: string;
  code: string;
  title: string;
  state: ProposalState;
  totalCents: number;
  // How many of its solutions have no price yet. Zero is not the same as a
  // $0 total: a free solution is priced, and a draft holding one can be sent.
  unpricedSolutions: number;
};

// A sent proposal's link, as the Dashboard query reads it: when it went and
// how often the customer has opened the current link.
export type BoardSent = { proposalId: string; sentAt: number; customerViews: number };

// When an approved or declined proposal was answered. The query that says so
// returns only the latest few; one it leaves out still sorts, just last.
export type BoardDecided = { proposalId: string; decidedAt: number };

export type BoardInvoice = {
  proposalId: string;
  kind: InvoiceKind;
  state: InvoiceState;
  standing: Standing | null;
  amountDueCents: number;
  createdAt: number;
};

export type BoardSite = { siteId: string; streetLine: string };

export type BoardInputs = {
  // Newest first, as proposals.list returns them.
  proposals: readonly BoardProposal[];
  sites: readonly BoardSite[];
  sent: readonly BoardSent[];
  decided: readonly BoardDecided[];
  invoices: readonly BoardInvoice[];
};

export type BoardRow = BoardProposal & {
  column: BoardColumnKey;
  street: string;
  hint: string;
  tone: HintTone;
};

export type BoardColumn = {
  key: BoardColumnKey;
  title: string;
  // What an empty column says, so it never reads as broken.
  empty: string;
  rows: BoardRow[];
  totalCents: number;
  // Whether the header shows the total. Drafts are not offers yet and done
  // work is history; only the two middle columns are money in play.
  showsTotal: boolean;
};

export type Board = {
  columns: BoardColumn[];
  // What customers owe on sent invoices, and how much of it is overdue: the
  // line under the page title, linking to Money.
  owedCents: number;
  lateCents: number;
};

const DayMs = 24 * 60 * 60 * 1000;

// Out with a customer this many days without being opened, a proposal gets
// the amber dot: long enough that the email may have gone astray, and worth
// a text.
export const NudgeAfterDays = 5;

const Columns: { key: BoardColumnKey; title: string; empty: string; showsTotal: boolean }[] = [
  { key: "draft", title: "Drafts", empty: "No drafts.", showsTotal: false },
  {
    key: "with_customer",
    title: "With customer",
    empty: "Nothing out with a customer.",
    showsTotal: true,
  },
  { key: "approved", title: "Approved · to do", empty: "No approved work open.", showsTotal: true },
  { key: "done", title: "Done & declined", empty: "Nothing finished yet.", showsTotal: false },
];

// "today", "3 days ago", "2 weeks ago": how long since, as roughly as a
// person would say it. Counted in whole 24-hour days from `now`.
export function ago(at: number, now: number): string {
  const days = Math.floor((now - at) / DayMs);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

// One proposal's place on the board, and how it is ordered inside its column:
// a bigger `rank` sits higher, ties broken by the more recent `at`.
type Placed = BoardRow & { rank: number; at: number };

export function proposalBoard(inputs: BoardInputs, now: number): Board {
  const streetOf = new Map(inputs.sites.map((site) => [site.siteId, site.streetLine]));
  const sentOf = new Map(inputs.sent.map((row) => [row.proposalId, row]));
  const decidedOf = new Map(inputs.decided.map((row) => [row.proposalId, row.decidedAt]));
  const invoicesOf = new Map<string, BoardInvoice[]>();
  for (const invoice of inputs.invoices) {
    const held = invoicesOf.get(invoice.proposalId) ?? [];
    held.push(invoice);
    invoicesOf.set(invoice.proposalId, held);
  }

  const placed = inputs.proposals.map((proposal, index): Placed => {
    const base = { ...proposal, street: streetOf.get(proposal.siteId) ?? "" };
    switch (proposal.state) {
      case "draft":
        // Drafts keep the list's own order, newest first: `at` counts down
        // from the top.
        return {
          ...base,
          column: "draft",
          hint: proposal.unpricedSolutions > 0 ? "No price yet" : "Not sent yet",
          tone: "quiet",
          rank: 0,
          at: -index,
        };
      case "sent":
        return { ...base, ...withCustomer(sentOf.get(proposal.proposalId), now) };
      case "declined": {
        const decidedAt = decidedOf.get(proposal.proposalId);
        return {
          ...base,
          column: "done",
          hint: decidedAt === undefined ? "Declined" : `Declined ${ago(decidedAt, now)}`,
          tone: "quiet",
          rank: 0,
          at: decidedAt ?? 0,
        };
      }
      case "approved": {
        const decidedAt = decidedOf.get(proposal.proposalId);
        return {
          ...base,
          ...approvedHint(invoicesOf.get(proposal.proposalId) ?? [], decidedAt, now),
          at: decidedAt ?? 0,
        };
      }
    }
  });

  const columns = Columns.map((column): BoardColumn => {
    const rows = placed
      .filter((row) => row.column === column.key)
      .sort((x, y) => y.rank - x.rank || y.at - x.at)
      .map(({ rank: _rank, at: _at, ...row }) => row);
    return {
      ...column,
      rows,
      totalCents: rows.reduce((total, row) => total + row.totalCents, 0),
    };
  });

  // Money owed is every sent invoice not yet paid, a bank payment still on
  // its way included: it is not in the account yet.
  const owing = inputs.invoices.filter(
    (invoice) =>
      invoice.state === "sent" &&
      (invoice.standing === "unpaid" ||
        invoice.standing === "overdue" ||
        invoice.standing === "on_its_way"),
  );
  return {
    columns,
    owedCents: sumDue(owing),
    lateCents: sumDue(owing.filter((invoice) => invoice.standing === "overdue")),
  };
}

// A proposal out with the customer: whether they have opened it and how long
// it has been out. The one waiting longest sits at the top, because that is
// the one to chase. One the Dashboard query has not caught up with yet reads
// as just sent.
function withCustomer(
  sent: BoardSent | undefined,
  now: number,
): Pick<Placed, "column" | "hint" | "tone" | "rank" | "at"> {
  const sentAt = sent?.sentAt ?? now;
  const views = sent?.customerViews ?? 0;
  const opened = views === 0 ? "Not opened yet" : `Viewed ${views === 1 ? "once" : `${views}×`}`;
  const stale = now - sentAt >= NudgeAfterDays * DayMs;
  return {
    column: "with_customer",
    hint: `${opened} · sent ${ago(sentAt, now)}`,
    tone: views === 0 && stale ? "nudge" : "quiet",
    rank: 0,
    // Oldest first: negate, since the column sorts the larger `at` higher.
    at: -sentAt,
  };
}

// An approved proposal, read from its invoices: the one thing the money says
// right now, in the order it matters. Late money first, then an invoice the
// owner wrote and has not sent, then whatever the customer still owes, then
// whether the work is waiting on him. A final invoice sent and fully paid is
// the job over, and moves it to Done.
//
// `rank` orders the Approved column: what needs the owner sits on top, what
// is waiting on the customer below it.
function approvedHint(
  invoices: readonly BoardInvoice[],
  decidedAt: number | undefined,
  now: number,
): Pick<Placed, "column" | "hint" | "tone" | "rank"> {
  // A void invoice was a mistake the owner took back; it says nothing.
  const live = invoices.filter((invoice) => invoice.state !== "void");
  const sent = live.filter((invoice) => invoice.state === "sent");
  const overdue = sent.filter((invoice) => invoice.standing === "overdue");
  const owing = sent.filter(
    (invoice) => invoice.standing === "unpaid" || invoice.standing === "on_its_way",
  );
  const unsent = live.find((invoice) => invoice.state === "draft");
  const final = live.find((invoice) => invoice.kind === "final");
  const deposit = live.find((invoice) => invoice.kind === "deposit");
  const approved = (hint: string, tone: HintTone, rank: number) =>
    ({ column: "approved", hint, tone, rank }) as const;

  if (overdue.length) return approved(`${formatCents(sumDue(overdue))} overdue`, "late", 4);
  if (unsent)
    return approved(
      unsent.kind === "final" ? "Final invoice written, not sent" : "Invoice written, not sent",
      "quiet",
      3,
    );
  if (final?.state === "sent") {
    if (owing.length === 0) return { column: "done", hint: "Paid in full", tone: "good", rank: 0 };
    return approved(`Final invoice sent · ${formatCents(sumDue(owing))} to come`, "quiet", 1);
  }
  if (deposit && owing.includes(deposit))
    return approved(
      deposit.standing === "on_its_way"
        ? "Deposit on its way"
        : `Deposit ${formatCents(deposit.amountDueCents)} not paid yet`,
      "quiet",
      1,
    );
  if (owing.length)
    return approved(`${formatCents(sumDue(owing))} invoiced, not paid yet`, "quiet", 1);
  if (deposit) return approved("Deposit paid · work to do", "good", 2);
  return approved(
    decidedAt === undefined ? "Approved · no deposit" : `Approved ${ago(decidedAt, now)} · no deposit`,
    "quiet",
    2,
  );
}

function sumDue(invoices: readonly BoardInvoice[]): number {
  return invoices.reduce((total, invoice) => total + invoice.amountDueCents, 0);
}

