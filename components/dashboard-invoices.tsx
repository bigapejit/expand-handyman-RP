"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { InvoiceChip } from "@/components/invoice-chips";
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { invoicePanelHref, invoiceSentLabel } from "@/lib/invoices";
import { formatCentsExact } from "@/lib/money";

type Dashboard = FunctionReturnType<typeof api.invoices.dashboard>;
type OwedRow = Dashboard["overdue"][number];

// The Dashboard's Invoices card, "Owed to you", drawn as the Proposals card
// is: what every sent invoice still owed comes to, then the Overdue ones, the
// longest waited on first, and the Unpaid ones, newest sent first. Paid,
// draft and void invoices never show. Every row opens the invoice in its
// panel on its site's Invoices tab.
export function DashboardInvoices() {
  const today = usePacificToday();
  const invoices = useQuery(api.invoices.dashboard, { today });

  return (
    <section aria-labelledby="dashboard-invoices-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="dashboard-invoices-heading" className="text-lg font-semibold tracking-tight">
          Invoices
        </h2>
        <p className="text-sm text-muted-foreground">Owed to you</p>
      </div>

      {invoices === undefined ? (
        <div className="grid min-h-32 place-items-center rounded-2xl border bg-white">
          <LoaderCircle
            aria-label="Loading invoices"
            className="size-5 animate-spin text-slate-500"
          />
        </div>
      ) : invoices.overdue.length === 0 && invoices.unpaid.length === 0 ? (
        <Quiet>
          Nothing is owed to you. Invoices come from approved proposals, on a
          site&rsquo;s Proposals tab.
        </Quiet>
      ) : (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-4 rounded-2xl border bg-white px-4 py-3">
            <span className="text-sm text-slate-500">
              {owedCount(invoices.overdue.length + invoices.unpaid.length)}
            </span>
            <span className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {formatCentsExact(invoices.owedCents)}
            </span>
          </div>
          {invoices.overdue.length > 0 ? (
            <div className="space-y-2">
              <GroupHeading>Overdue</GroupHeading>
              <InvoiceList rows={invoices.overdue} />
            </div>
          ) : null}
          {invoices.unpaid.length > 0 ? (
            <div className="space-y-2">
              <GroupHeading>Unpaid</GroupHeading>
              <InvoiceList rows={invoices.unpaid} />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function owedCount(count: number): string {
  return count === 1 ? "On 1 invoice" : `On ${count} invoices`;
}

function InvoiceList({ rows }: { rows: OwedRow[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
      {rows.map((row) => (
        <li key={row.invoiceId}>
          <Link
            href={invoicePanelHref(row.siteId, row.invoiceId)}
            className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="truncate font-medium text-slate-900">{row.customerName}</span>
                <InvoiceChip state={row.state} standing={row.standing} />
              </p>
              <p className="text-sm text-slate-500 sm:truncate">
                {row.title} · {invoiceSentLabel(row.sentAt)}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
              {formatCentsExact(row.amountDueCents)}
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-medium text-slate-500">{children}</h3>;
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed bg-slate-50 px-6 py-6 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}
