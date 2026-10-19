"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { formatCents } from "@/lib/money";

// PROTOTYPE (proposals-first): throwaway. Every proposal, sorted into what it
// needs from the owner, with one plain sentence each. Read only from queries
// that already exist (proposals.list, proposals.dashboard, sites.list,
// invoices.list), stitched together here in the browser; a real build would
// do this in one Convex query.

type ListRow = FunctionReturnType<typeof api.proposals.list>[number];
type InvoiceRow = FunctionReturnType<typeof api.invoices.list>[number];

export type Group = "draft" | "waiting" | "approved" | "done";

// Whose move it is, for variant B.
export type Move = "yours" | "theirs" | "none";

// How loud a hint is: most are quiet; money late or a link never opened in a
// week is the one thing worth colour.
export type Tone = "quiet" | "good" | "nudge" | "attention";

export type BoardRow = {
  proposalId: ListRow["proposalId"];
  siteId: ListRow["siteId"];
  customerId: ListRow["customerId"];
  customerName: string;
  street: string;
  title: string;
  code: string;
  totalCents: number;
  state: ListRow["state"];
  group: Group;
  hint: string;
  tone: Tone;
  move: Move;
  // The verb for variant B's "Your move" list.
  nextStep: string | null;
  // Bigger is more urgent, for variant B's order.
  urgency: number;
  // When it last moved, for ordering inside a group.
  at: number;
  invoices: InvoiceRow[];
};

export type Board = {
  rows: BoardRow[];
  owedCents: number;
  overdueCents: number;
};

const Day = 24 * 60 * 60 * 1000;

export function ago(at: number, now: number): string {
  const days = Math.floor((now - at) / Day);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function useBoard(): Board | undefined {
  const today = usePacificToday();
  const list = useQuery(api.proposals.list);
  const dashboard = useQuery(api.proposals.dashboard);
  const sites = useQuery(api.sites.list);
  const invoices = useQuery(api.invoices.list, { filter: "all", today });
  if (!list || !dashboard || !sites || !invoices) return undefined;

  const now = Date.now();
  const streetOf = new Map(sites.map((site) => [site.siteId, site.streetLine]));
  const awaiting = new Map(dashboard.awaiting.map((row) => [row.proposalId, row]));
  const decided = new Map(dashboard.decided.map((row) => [row.proposalId, row]));
  const invoicesOf = new Map<string, InvoiceRow[]>();
  for (const invoice of invoices) {
    const held = invoicesOf.get(invoice.proposalId) ?? [];
    held.push(invoice);
    invoicesOf.set(invoice.proposalId, held);
  }

  const rows = list.map((row): BoardRow => {
    const base = {
      proposalId: row.proposalId,
      siteId: row.siteId,
      customerId: row.customerId,
      customerName: row.customerName,
      street: streetOf.get(row.siteId) ?? "",
      title: row.title,
      code: row.code,
      totalCents: row.totalCents,
      state: row.state,
      invoices: (invoicesOf.get(row.proposalId) ?? []).sort((x, y) => x.createdAt - y.createdAt),
    };

    if (row.state === "draft") {
      const unpriced = row.totalCents === 0;
      return {
        ...base,
        group: "draft",
        hint: unpriced ? "No price yet" : "Not sent yet",
        tone: "quiet",
        move: "yours",
        nextStep: unpriced ? "Price it" : "Send it",
        urgency: 75,
        at: 0,
      };
    }

    if (row.state === "sent") {
      const out = awaiting.get(row.proposalId);
      const sentAt = out?.sentAt ?? now;
      const views = out?.customerViews ?? 0;
      const days = (now - sentAt) / Day;
      const opened = views > 0;
      const stale = days >= 5;
      return {
        ...base,
        group: "waiting",
        hint: `${opened ? `Viewed ${views === 1 ? "once" : `${views}×`}` : "Not opened yet"} · sent ${ago(sentAt, now)}`,
        tone: !opened && stale ? "nudge" : "quiet",
        // A week out with no answer is the owner's move again: a nudge.
        move: stale ? "yours" : "theirs",
        nextStep: stale ? (opened ? "Follow up" : "Nudge them") : null,
        urgency: stale ? 40 + Math.min(days, 30) : 0,
        at: sentAt,
      };
    }

    if (row.state === "declined") {
      const when = decided.get(row.proposalId)?.decidedAt;
      return {
        ...base,
        group: "done",
        hint: when ? `Declined ${ago(when, now)}` : "Declined",
        tone: "quiet",
        move: "none",
        nextStep: null,
        urgency: 0,
        at: when ?? 0,
      };
    }

    // Approved: what the money says.
    const live = base.invoices.filter((invoice) => invoice.state !== "void");
    const sent = live.filter((invoice) => invoice.state === "sent");
    const overdue = sent.filter((invoice) => invoice.standing === "overdue");
    const unpaid = sent.filter(
      (invoice) => invoice.standing === "unpaid" || invoice.standing === "on_its_way",
    );
    const final = live.find((invoice) => invoice.kind === "final");
    const deposit = live.find((invoice) => invoice.kind === "deposit");
    const draftInvoice = live.find((invoice) => invoice.state === "draft");
    const approvedAt = decided.get(row.proposalId)?.decidedAt ?? 0;
    const sum = (rows: InvoiceRow[]) => rows.reduce((total, r) => total + r.amountDueCents, 0);

    const approved = (
      hint: string,
      tone: Tone,
      move: Move,
      nextStep: string | null,
      urgency: number,
    ): BoardRow => ({ ...base, group: "approved", hint, tone, move, nextStep, urgency, at: approvedAt });

    if (overdue.length)
      return approved(`${formatCents(sum(overdue))} overdue`, "attention", "yours", "Chase payment", 100);
    if (draftInvoice)
      return approved(
        draftInvoice.kind === "final" ? "Final invoice written, not sent" : "Invoice written, not sent",
        "quiet",
        "yours",
        "Send the invoice",
        80,
      );
    if (final && final.state === "sent" && unpaid.length === 0)
      return { ...approved("Paid in full", "good", "none", null, 0), group: "done" };
    if (final && unpaid.length)
      return approved(`Final invoice sent · ${formatCents(sum(unpaid))} to come`, "quiet", "theirs", null, 0);
    if (deposit && unpaid.includes(deposit))
      return approved(
        deposit.standing === "on_its_way"
          ? "Deposit on its way"
          : `Deposit ${formatCents(deposit.amountDueCents)} not paid yet`,
        "quiet",
        "theirs",
        null,
        0,
      );
    if (deposit)
      return approved("Deposit paid · work to do", "good", "yours", "Job done? Invoice it", 60);
    return approved(
      `Approved ${approvedAt ? ago(approvedAt, now) : ""} · no deposit`.trim(),
      "quiet",
      "yours",
      "Job done? Invoice it",
      60,
    );
  });

  const owed = invoices.filter(
    (invoice) =>
      invoice.state === "sent" &&
      (invoice.standing === "unpaid" ||
        invoice.standing === "overdue" ||
        invoice.standing === "on_its_way"),
  );
  return {
    rows,
    owedCents: owed.reduce((total, invoice) => total + invoice.amountDueCents, 0),
    overdueCents: owed
      .filter((invoice) => invoice.standing === "overdue")
      .reduce((total, invoice) => total + invoice.amountDueCents, 0),
  };
}
