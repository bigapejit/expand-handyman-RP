"use client";

import { useQuery } from "convex/react";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { NewProposalButton } from "@/components/new-proposal";
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { formatCents } from "@/lib/money";
import {
  proposalBoard,
  type Board,
  type BoardColumn,
  type BoardRow,
  type HintTone,
} from "@/lib/proposal-board";
import { proposalPageHref } from "@/lib/proposals";
import { cn } from "@/lib/utils";

// The **Proposal board** (CONTEXT.md), the home page: every proposal in four
// columns by how far the job has got, read from the queries that already
// exist and sorted by lib/proposal-board.ts. Undefined until all four have
// answered.
//
// The hints count days from "now", which a query cannot say without going
// stale, so the page keeps its own clock and moves it on every minute.
export function useProposalBoard(): Board | undefined {
  const today = usePacificToday();
  const now = useNow();
  const proposals = useQuery(api.proposals.list);
  const dashboard = useQuery(api.proposals.dashboard);
  const sites = useQuery(api.sites.list);
  const invoices = useQuery(api.invoices.list, { filter: "all", today });
  if (!proposals || !dashboard || !sites || !invoices) return undefined;
  return proposalBoard(
    {
      proposals,
      sites,
      sent: dashboard.awaiting,
      decided: dashboard.decided,
      invoices,
    },
    now,
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function ProposalBoard() {
  const board = useProposalBoard();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Proposals</h1>
          {board ? <OwedLine owedCents={board.owedCents} lateCents={board.lateCents} /> : null}
        </div>
        <NewProposalButton className="max-md:w-full" />
      </header>

      {board === undefined ? (
        <div className="grid min-h-64 place-items-center">
          <LoaderCircle
            aria-label="Loading proposals"
            className="size-6 animate-spin text-slate-400"
          />
        </div>
      ) : (
        <Columns columns={board.columns} />
      )}
    </div>
  );
}

// What customers owe, and how much of it is late, linking to Money.
function OwedLine({ owedCents, lateCents }: { owedCents: number; lateCents: number }) {
  if (owedCents === 0)
    return <p className="text-slate-500">Nobody owes you anything right now.</p>;
  return (
    <p className="text-slate-600">
      <Link href="/invoices" className="hover:underline">
        <span className="font-semibold text-slate-900 tabular-nums">
          {formatCents(owedCents)}
        </span>{" "}
        owed to you
        {lateCents > 0 ? (
          <>
            {" · "}
            <span className="font-medium text-red-700 tabular-nums">
              {formatCents(lateCents)} late
            </span>
          </>
        ) : null}
      </Link>
    </p>
  );
}

// The board: one column per stage, left to right in the order a job moves. No
// cards: columns are split by a hairline and the jobs inside a column by
// another, so the board reads as one sheet. On a phone the columns scroll
// sideways and snap, one column most of a screen wide at a time, with the
// edge of the next showing so it is plain there is more.
function Columns({ columns }: { columns: BoardColumn[] }) {
  return (
    <div className="no-scrollbar -mx-4 snap-x snap-mandatory overflow-x-auto md:mx-0 md:overflow-visible">
      <div className="grid w-max grid-cols-[repeat(4,85vw)] border-y border-slate-200 md:w-full md:grid-cols-4">
        {columns.map((column, index) => (
          <section
            key={column.key}
            aria-label={column.title}
            className={cn("min-w-0 snap-start", index > 0 && "border-l border-slate-200")}
          >
            <header className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold whitespace-nowrap text-slate-900">
                {column.title}
                {column.rows.length > 0 ? (
                  <span className="ml-1.5 font-normal text-slate-400">{column.rows.length}</span>
                ) : null}
              </h2>
              {column.showsTotal && column.rows.length > 0 ? (
                <span className="text-xs text-slate-500 tabular-nums">
                  {formatCents(column.totalCents)}
                </span>
              ) : null}
            </header>
            {column.rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400">{column.empty}</p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {column.rows.map((row) => (
                  <li key={row.proposalId}>
                    <BoardItem row={row} muted={column.key === "done"} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

// One job on the board: who and what it costs on the first line, where and
// what under it, and the one plain hint last. Sized for a quarter of the page.
function BoardItem({ row, muted }: { row: BoardRow; muted: boolean }) {
  return (
    <Link
      href={proposalPageHref(row.proposalId)}
      className="block space-y-1 px-4 py-3 transition-colors hover:bg-amber-50/50"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "min-w-0 truncate text-[15px] font-medium",
            muted ? "text-slate-600" : "text-slate-900",
          )}
        >
          {row.customerName}
        </span>
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            muted ? "text-slate-500" : "text-slate-900",
          )}
        >
          {row.totalCents ? formatCents(row.totalCents) : "—"}
        </span>
      </span>
      <span className="line-clamp-2 block text-sm text-slate-500">
        {[row.street, row.title].filter(Boolean).join(" · ")}
      </span>
      <Hint tone={row.tone}>{row.hint}</Hint>
    </Link>
  );
}

// A hint, quiet grey unless its tone says otherwise, with a dot of the same
// colour so the few loud ones are found at a glance.
export function Hint({ tone, children }: { tone: HintTone; children: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm",
        tone === "late" && "font-medium text-red-700",
        tone === "nudge" && "text-amber-800",
        tone === "good" && "text-emerald-700",
        tone === "quiet" && "text-slate-500",
      )}
    >
      {tone !== "quiet" ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "late" && "bg-red-500",
            tone === "nudge" && "bg-amber-500",
            tone === "good" && "bg-emerald-500",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
