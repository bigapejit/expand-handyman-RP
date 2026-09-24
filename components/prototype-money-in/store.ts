// PROTOTYPE (#130): throwaway. Made-up deposits and invoices, the match the
// app would suggest for each, and what the owner can do about it, all in
// memory. Reload and it is back to the start. Nothing here reads Convex.
//
// The banks, as settled on the map on 2026-09-24: Zelle lands at U.S. Bank,
// checks and transfers land in Relay, and Stripe pays out into Relay.

import { useSyncExternalStore } from "react";

export const Today = "2026-09-23";

export type Bank = "relay" | "usbank";
export type DepositKind = "zelle" | "check" | "transfer" | "stripe" | "refund";

export type Deposit = {
  id: string;
  day: string; // YYYY-MM-DD, the day it posted
  amountCents: number;
  bank: Bank;
  kind: DepositKind;
  description: string; // the bank's own line, as Plaid hands it over
  memo?: string; // Zelle memo, when the payer wrote one
};

export type DepositStatus =
  | { kind: "waiting" }
  | { kind: "matched"; invoiceIds: string[]; by: "you" | "itself" }
  | { kind: "dismissed" } // "Not an invoice": the owner's own money, a refund
  | { kind: "payout" }; // a Stripe payout, set aside by the app

export type Invoice = {
  id: string;
  number: string;
  kind: string; // Deposit, Final, or the typed title
  customerName: string;
  amountDueCents: number;
  sentDay: string;
  // A payment the owner marked by hand, if any. A deposit matched to the
  // invoice is the other way it reads Paid; that lives on the deposit.
  ownerPayment: { receivedOn: string } | null;
};

export type Mode = "confirm" | "auto";

// ── The made-up rows ─────────────────────────────────────────────────────
export const Invoices: Invoice[] = [
  { id: "inv-1001", number: "INV-1001", kind: "Deposit", customerName: "Dana Whitfield", amountDueCents: 285_437, sentDay: "2026-09-20", ownerPayment: null },
  { id: "inv-1002", number: "INV-1002", kind: "Final", customerName: "Frank Osei", amountDueCents: 98_000, sentDay: "2026-09-10", ownerPayment: { receivedOn: "2026-09-18" } },
  { id: "inv-1003", number: "INV-1003", kind: "Final", customerName: "Linda Park", amountDueCents: 121_560, sentDay: "2026-09-12", ownerPayment: null },
  { id: "inv-1004", number: "INV-1004", kind: "Deposit", customerName: "Raj Patel", amountDueCents: 120_000, sentDay: "2026-09-15", ownerPayment: null },
  { id: "inv-1005", number: "INV-1005", kind: "Gate latch", customerName: "Raj Patel", amountDueCents: 75_000, sentDay: "2026-09-16", ownerPayment: null },
  { id: "inv-1006", number: "INV-1006", kind: "Deposit", customerName: "Maria Alvarez", amountDueCents: 50_000, sentDay: "2026-09-19", ownerPayment: null },
  { id: "inv-1007", number: "INV-1007", kind: "Deposit", customerName: "Tom Reyes", amountDueCents: 50_000, sentDay: "2026-09-21", ownerPayment: null },
  { id: "inv-1008", number: "INV-1008", kind: "Final", customerName: "Chris Nguyen", amountDueCents: 130_000, sentDay: "2026-09-08", ownerPayment: null },
  { id: "inv-0998", number: "INV-0998", kind: "Final", customerName: "Sam Okafor", amountDueCents: 64_000, sentDay: "2026-09-05", ownerPayment: null },
];

export const Deposits: Deposit[] = [
  { id: "d1", day: "2026-09-23", amountCents: 285_437, bank: "usbank", kind: "zelle", description: "ZELLE FROM WHITFIELD DANA", memo: "INV-1001" },
  { id: "d2", day: "2026-09-22", amountCents: 50_000, bank: "usbank", kind: "zelle", description: "ZELLE FROM ALVAREZ MARIA" },
  { id: "d3", day: "2026-09-22", amountCents: 124_000, bank: "relay", kind: "check", description: "MOBILE CHECK DEPOSIT" },
  { id: "d4", day: "2026-09-22", amountCents: 310_211, bank: "relay", kind: "stripe", description: "STRIPE TRANSFER ST-N8K2M4" },
  { id: "d5", day: "2026-09-21", amountCents: 195_000, bank: "usbank", kind: "zelle", description: "ZELLE FROM PATEL RAJ", memo: "gate + deposit" },
  { id: "d6", day: "2026-09-19", amountCents: 98_000, bank: "relay", kind: "check", description: "MOBILE CHECK DEPOSIT" },
  { id: "d7", day: "2026-09-18", amountCents: 500_000, bank: "relay", kind: "transfer", description: "ONLINE TRANSFER FROM CHK ...4412" },
  { id: "d8", day: "2026-09-17", amountCents: 8_613, bank: "relay", kind: "refund", description: "HOME DEPOT #4712 REFUND" },
  { id: "d9", day: "2026-09-15", amountCents: 64_000, bank: "usbank", kind: "zelle", description: "ZELLE FROM OKAFOR SAM" },
];

// ── What the app would suggest for a waiting deposit ─────────────────────
export type Suggestion =
  | { kind: "one"; invoiceId: string } // one open invoice for exactly this amount
  | { kind: "pair"; invoiceIds: string[] } // two of one customer's add up to it
  | { kind: "several"; invoiceIds: string[]; nameMatch: string | null } // more than one for this amount
  | { kind: "alreadyPaid"; invoiceId: string } // the only invoice for this amount is marked paid by hand
  | { kind: "none"; nearest: string[] }; // nothing fits; the nearest open ones, for the picker

export function suggest(deposit: Deposit, statuses: Statuses): Suggestion {
  const open = openInvoices(statuses);
  const exact = open.filter((inv) => inv.amountDueCents === deposit.amountCents);
  const byName = exact.find((inv) => payerMatches(deposit, inv));
  if (exact.length === 1) return { kind: "one", invoiceId: exact[0].id };
  if (exact.length > 1)
    return {
      kind: "several",
      invoiceIds: [...exact].sort((a, b) => (a === byName ? -1 : b === byName ? 1 : 0)).map((i) => i.id),
      nameMatch: byName?.id ?? null,
    };
  // Two invoices of one customer's that add up to the deposit.
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++)
      if (
        open[i].customerName === open[j].customerName &&
        open[i].amountDueCents + open[j].amountDueCents === deposit.amountCents
      )
        return { kind: "pair", invoiceIds: [open[i].id, open[j].id] };
  const paid = Invoices.filter(
    (inv) => inv.ownerPayment && inv.amountDueCents === deposit.amountCents && !matchedBy(inv.id, statuses),
  );
  if (paid.length === 1) return { kind: "alreadyPaid", invoiceId: paid[0].id };
  const nearest = [...open]
    .sort(
      (a, b) =>
        Math.abs(a.amountDueCents - deposit.amountCents) - Math.abs(b.amountDueCents - deposit.amountCents),
    )
    .slice(0, 3)
    .map((i) => i.id);
  return { kind: "none", nearest };
}

function payerMatches(deposit: Deposit, invoice: Invoice): boolean {
  const words = deposit.description.toUpperCase();
  return invoice.customerName
    .toUpperCase()
    .split(" ")
    .every((part) => words.includes(part));
}

// ── The store ────────────────────────────────────────────────────────────
export type Statuses = Record<string, DepositStatus>;

type State = { mode: Mode; statuses: Statuses };

function initial(mode: Mode): State {
  const statuses: Statuses = {};
  for (const d of Deposits) statuses[d.id] = d.kind === "stripe" ? { kind: "payout" } : { kind: "waiting" };
  // Matched last week, so the list has a done row to read against.
  statuses.d9 = { kind: "matched", invoiceIds: ["inv-0998"], by: "you" };
  if (mode === "auto") {
    // The app marks a deposit with one exact open match by itself, oldest
    // first so a later deposit never steals an earlier one's invoice.
    for (const d of [...Deposits].reverse()) {
      if (statuses[d.id].kind !== "waiting") continue;
      const s = suggest(d, statuses);
      if (s.kind === "one") statuses[d.id] = { kind: "matched", invoiceIds: [s.invoiceId], by: "itself" };
    }
  }
  return { mode, statuses };
}

let state: State = initial("confirm");
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const actions = {
  reset(mode: Mode) {
    if (state.mode === mode) return;
    state = initial(mode);
    emit();
  },
  match(depositId: string, invoiceIds: string[]) {
    state = { ...state, statuses: { ...state.statuses, [depositId]: { kind: "matched", invoiceIds, by: "you" } } };
    emit();
  },
  undo(depositId: string) {
    state = { ...state, statuses: { ...state.statuses, [depositId]: { kind: "waiting" } } };
    emit();
  },
  dismiss(depositId: string) {
    state = { ...state, statuses: { ...state.statuses, [depositId]: { kind: "dismissed" } } };
    emit();
  },
};

// ── Reading the rows ─────────────────────────────────────────────────────
export function invoiceById(id: string): Invoice {
  const found = Invoices.find((inv) => inv.id === id);
  if (!found) throw new Error(`no invoice ${id}`);
  return found;
}

export function depositById(id: string): Deposit {
  const found = Deposits.find((d) => d.id === id);
  if (!found) throw new Error(`no deposit ${id}`);
  return found;
}

// The deposit matched to an invoice, if one is.
export function matchedBy(invoiceId: string, statuses: Statuses): Deposit | null {
  for (const d of Deposits) {
    const s = statuses[d.id];
    if (s.kind === "matched" && s.invoiceIds.includes(invoiceId)) return d;
  }
  return null;
}

export function openInvoices(statuses: Statuses): Invoice[] {
  return Invoices.filter((inv) => !inv.ownerPayment && !matchedBy(inv.id, statuses));
}

export type Standing = "unpaid" | "overdue" | "paid";

export function standingOf(invoice: Invoice, statuses: Statuses): Standing {
  if (invoice.ownerPayment || matchedBy(invoice.id, statuses)) return "paid";
  return daysBetween(invoice.sentDay, Today) > 7 ? "overdue" : "unpaid";
}

export function waitingDeposits(statuses: Statuses): Deposit[] {
  return Deposits.filter((d) => statuses[d.id].kind === "waiting");
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

// "Sept 23", the way the panel writes a day, from `YYYY-MM-DD`.
const Months = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
export function shortDay(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${Months[month - 1]} ${date}`;
}

export function bankName(bank: Bank): string {
  return bank === "relay" ? "Relay" : "U.S. Bank";
}

export function kindName(kind: DepositKind): string {
  switch (kind) {
    case "zelle":
      return "Zelle";
    case "check":
      return "Check";
    case "transfer":
      return "Transfer";
    case "stripe":
      return "Stripe payout";
    case "refund":
      return "Refund";
  }
}

// "by Zelle landed in U.S. Bank", the words after the day in the panel.
export function howLanded(deposit: Deposit): string {
  const by = deposit.kind === "zelle" ? "Zelle" : deposit.kind === "check" ? "check" : "transfer";
  return `by ${by} landed in ${bankName(deposit.bank)}`;
}
