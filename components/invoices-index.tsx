"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LoaderCircle, ReceiptText, Search } from "lucide-react";
import { useState } from "react";

import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { InvoiceChip } from "@/components/invoice-chips";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import {
  invoiceFilters,
  invoicePanelHref,
  matchesInvoiceSearch,
  type InvoiceFilter,
} from "@/lib/invoices";
import { formatCentsExact } from "@/lib/money";
import { cn } from "@/lib/utils";

type InvoiceRows = FunctionReturnType<typeof api.invoices.list>;

// Every invoice across every customer, as FRSG's flat indexes are: landing on
// what is still owed, overdue first. Read-only, with no New invoice: a row
// opens the invoice's panel on its customer's Invoices tab, and every invoice
// starts from its proposal. Search reads the customer, the number and the
// title.
export function InvoicesIndex() {
  const today = usePacificToday();
  const [filter, setFilter] = useState<InvoiceFilter>("unpaid");
  const [search, setSearch] = useState("");
  const fetched = useQuery(api.invoices.list, { filter, today });
  // Switching filters keeps the last list on screen until the next arrives,
  // rather than blinking a spinner between two lists. Set while rendering,
  // React's way to keep state derived from a prop: Convex hands back the same
  // array until the answer changes, so this settles after one pass.
  const [last, setLast] = useState<InvoiceRows | undefined>(undefined);
  if (fetched !== undefined && fetched !== last) setLast(fetched);
  const invoices = fetched ?? last;
  const shown = invoices?.filter((invoice) => matchesInvoiceSearch(invoice, search));

  return (
    <div className="space-y-4">
      <label className="relative block w-full max-w-md">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by customer, number or title"
          aria-label="Search invoices"
          className="h-9 pl-8"
        />
      </label>
      <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
        <Segmented label="Standing" value={filter} onChange={setFilter} options={invoiceFilters} />
      </div>

      {shown === undefined ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <LoaderCircle aria-label="Loading invoices" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : shown.length === 0 ? (
        invoices?.length ? (
          <IndexEmptyState icon={ReceiptText} title="No invoice matches that">
            Try a different search or filter.
          </IndexEmptyState>
        ) : (
          <IndexEmptyState icon={ReceiptText} title={emptyTitle[filter]}>
            {emptyBody[filter]}
          </IndexEmptyState>
        )
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((invoice) => (
            <IndexRow
              key={invoice.invoiceId}
              href={invoicePanelHref(invoice.customerId, invoice.invoiceId)}
              title={invoice.title}
              subtitle={invoice.customerName}
              struck={invoice.state === "void"}
              hint={
                <>
                  <InvoiceChip state={invoice.state} standing={invoice.standing} />
                  <span
                    className={cn(
                      "font-semibold text-slate-900 tabular-nums",
                      invoice.state === "void" && "text-slate-400 line-through",
                    )}
                  >
                    {formatCentsExact(invoice.amountDueCents)}
                  </span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const emptyTitle: Record<InvoiceFilter, string> = {
  unpaid: "Nothing is owed right now",
  overdue: "Nothing is overdue",
  paid: "No paid invoices yet",
  all: "No invoices yet",
};

const emptyBody: Record<InvoiceFilter, string> = {
  unpaid: "Nothing sent is waiting on money. Drafts and void invoices are under All.",
  overdue: "An unpaid invoice turns overdue seven days after the day it was sent.",
  paid: "An invoice reads Paid once its money is recorded, or when nothing is due on it.",
  all: "They come from approved proposals.",
};
