"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ProposalStateChip } from "@/components/proposal-chips";
import { api } from "@/convex/_generated/api";
import { openedLine } from "@/lib/dashboard-lines";
import { formatCents } from "@/lib/money";
import { proposalDecidedLine, proposalPanelHref, sentLine } from "@/lib/proposals";

type Dashboard = FunctionReturnType<typeof api.proposals.dashboard>;
type AwaitingRow = Dashboard["awaiting"][number];
type DecidedRow = Dashboard["decided"][number];

// FRSG's Dashboard Proposals card: what is out with a customer across every
// site, the one waiting longest first and each saying whether the customer
// has opened its current link, then the few most recently decided. Every row
// opens that proposal in its panel on its site's Proposals tab; nothing
// here is edited.
export function DashboardProposals() {
  const proposals = useQuery(api.proposals.dashboard);
  // One reading of the clock for the whole card, so rows agree on "today".
  const now = Date.now();

  return (
    <section aria-labelledby="dashboard-proposals-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="dashboard-proposals-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Proposals
        </h2>
        <p className="text-sm text-muted-foreground">Out with customers</p>
      </div>

      {proposals === undefined ? (
        <div className="grid min-h-32 place-items-center rounded-2xl border bg-white">
          <LoaderCircle
            aria-label="Loading proposals"
            className="size-5 animate-spin text-slate-500"
          />
        </div>
      ) : proposals.awaiting.length === 0 && proposals.decided.length === 0 ? (
        <Quiet>
          No proposal has been sent yet. They are assembled and sent on a
          site&rsquo;s Proposals tab.
        </Quiet>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <GroupHeading>Awaiting a signature</GroupHeading>
            {proposals.awaiting.length === 0 ? (
              <Quiet>Nothing is waiting on a customer.</Quiet>
            ) : (
              <ProposalList
                rows={proposals.awaiting}
                line={(row) => awaitingLine(row, now)}
              />
            )}
          </div>
          {proposals.decided.length > 0 ? (
            <div className="space-y-2">
              <GroupHeading>Recently decided</GroupHeading>
              <ProposalList
                rows={proposals.decided}
                line={(row) => `${row.customerName} · ${proposalDecidedLine(row)}`}
                chip={(row) => <ProposalStateChip state={row.state} />}
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ProposalList<Row extends AwaitingRow | DecidedRow>({
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
        <li key={row.proposalId}>
          <Link
            href={proposalPanelHref(row.siteId, row.proposalId)}
            className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="shrink-0 font-medium text-slate-900">
                  {row.code}
                </span>
                <span className="truncate text-sm text-slate-500">
                  {row.title}
                </span>
                {chip?.(row)}
              </p>
              {/* Wraps on a phone rather than cutting off whether it was
                  opened, as IndexRow keeps its hint there. */}
              <p className="text-sm text-slate-500 sm:truncate">{line(row)}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
              {formatCents(row.totalCents)}
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function awaitingLine(row: AwaitingRow, now: number): string {
  return [
    row.customerName,
    sentLine(row.sentAt),
    openedLine(row.customerViews, row.lastViewedAt ?? undefined, now),
  ].join(" · ");
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
