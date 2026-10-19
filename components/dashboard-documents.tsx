"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DocumentStatusChip } from "@/components/document-chips";
import { api } from "@/convex/_generated/api";
import { decidedLine, issuedLine, openedLine } from "@/lib/dashboard-lines";

type Dashboard = FunctionReturnType<typeof api.documents.dashboard>;
type OutRow = Dashboard["out"][number];
type DecidedRow = Dashboard["decided"][number];

// FRSG's Dashboard Proposals card, for uploaded documents: what is out with a
// customer, the one waiting longest first and each saying whether it has been
// opened, then the few most recently answered. Every row opens the document.
export function DashboardDocuments() {
  const documents = useQuery(api.documents.dashboard);
  // One reading of the clock for the whole card, so rows agree on "today".
  const now = Date.now();

  return (
    <section aria-labelledby="dashboard-documents-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="dashboard-documents-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Documents
        </h2>
        <p className="text-sm text-muted-foreground">Out with customers</p>
      </div>

      {documents === undefined ? (
        <div className="grid min-h-32 place-items-center rounded-2xl border bg-white">
          <LoaderCircle
            aria-label="Loading documents"
            className="size-5 animate-spin text-slate-500"
          />
        </div>
      ) : documents.out.length === 0 && documents.decided.length === 0 ? (
        <Quiet>
          No document has gone out yet. Upload one on the Documents page and
          create its signing link.
        </Quiet>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <GroupHeading>Out for signature</GroupHeading>
            {documents.out.length === 0 ? (
              <Quiet>Nothing is waiting on a customer.</Quiet>
            ) : (
              <DocumentList
                rows={documents.out}
                line={(row) => outLine(row, now)}
              />
            )}
          </div>
          {documents.decided.length > 0 ? (
            <div className="space-y-2">
              <GroupHeading>Recently signed or declined</GroupHeading>
              <DocumentList
                rows={documents.decided}
                line={(row) => `${row.customerName} · ${decidedLine(row)}`}
                chip={(row) => <DocumentStatusChip status={row.status} />}
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function DocumentList<Row extends OutRow | DecidedRow>({
  rows,
  line,
  chip,
}: {
  rows: Row[];
  line: (row: Row) => string;
  chip?: (row: Row) => ReactNode;
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
      {rows.map((row) => (
        <li key={row._id}>
          <Link
            href={`/documents/${row._id}`}
            className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="truncate font-medium text-slate-900">
                  {row.title}
                </span>
                {chip?.(row)}
              </p>
              {/* Wraps on a phone rather than cutting off whether it was
                  opened, as IndexRow keeps its hint there. */}
              <p className="text-sm text-slate-500 sm:truncate">{line(row)}</p>
            </div>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function outLine(row: OutRow, now: number): string {
  return [
    row.customerName,
    row.issuedAt === undefined ? null : issuedLine(row.issuedAt),
    openedLine(row.customerViews, row.lastViewedAt, now),
  ]
    .filter(Boolean)
    .join(" · ");
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
