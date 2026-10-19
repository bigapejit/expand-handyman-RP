"use client";

import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useBoard, type BoardRow, type Group } from "@/components/prototype-proposals-first/board";
import { NewProposalButton } from "@/components/prototype-proposals-first/new-proposal";
import { PrototypeBar, useVariant } from "@/components/prototype-proposals-first/prototype-bar";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

// PROTOTYPE (proposals-first): throwaway. The home page is the proposals,
// sorted by what each one needs from the owner rather than filtered in a
// table. A sorts them by stage; B by whose move it is.
export function ProposalsHome() {
  const board = useBoard();
  const variant = useVariant();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <PrototypeBar switchable />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Proposals</h1>
          {board ? <OwedLine owedCents={board.owedCents} overdueCents={board.overdueCents} /> : null}
        </div>
        <NewProposalButton className="max-md:w-full" />
      </header>

      {board === undefined ? (
        <div className="grid min-h-64 place-items-center">
          <LoaderCircle aria-label="Loading proposals" className="size-6 animate-spin text-slate-400" />
        </div>
      ) : board.rows.length === 0 ? (
        <p className="py-16 text-center text-slate-500">
          No proposals yet. Start one with New proposal.
        </p>
      ) : variant === "A" ? (
        <ByStage rows={board.rows} />
      ) : (
        <WhoseMove rows={board.rows} />
      )}
    </div>
  );
}

function OwedLine({ owedCents, overdueCents }: { owedCents: number; overdueCents: number }) {
  if (owedCents === 0) return <p className="text-slate-500">Nobody owes you anything right now.</p>;
  return (
    <p className="text-slate-600">
      <Link href="/invoices" className="hover:underline">
        <span className="font-semibold text-slate-900 tabular-nums">{formatCents(owedCents)}</span>{" "}
        owed to you
        {overdueCents > 0 ? (
          <>
            {" · "}
            <span className="font-medium text-red-700 tabular-nums">
              {formatCents(overdueCents)} late
            </span>
          </>
        ) : null}
      </Link>
    </p>
  );
}

// Variant A: four stages, the last folded away.
const stages: { group: Exclude<Group, "done">; title: string; empty: string }[] = [
  { group: "draft", title: "Drafts to finish", empty: "No drafts." },
  { group: "waiting", title: "Waiting on the customer", empty: "Nothing out with a customer." },
  { group: "approved", title: "Approved · work to do", empty: "No approved work open." },
];

function ByStage({ rows }: { rows: BoardRow[] }) {
  const inGroup = (group: Group) => rows.filter((row) => row.group === group);
  return (
    <div className="space-y-10">
      {stages.map((stage) => {
        const held = inGroup(stage.group);
        const ordered =
          stage.group === "waiting"
            ? [...held].sort((x, y) => x.at - y.at)
            : stage.group === "approved"
              ? [...held].sort((x, y) => y.urgency - x.urgency || y.at - x.at)
              : held;
        return (
          <Section
            key={stage.group}
            title={stage.title}
            count={held.length}
            totalCents={stage.group === "draft" ? null : sumTotals(held)}
          >
            {held.length === 0 ? (
              <p className="px-1 text-slate-400">{stage.empty}</p>
            ) : (
              <RowList rows={ordered} />
            )}
          </Section>
        );
      })}
      <Folded rows={inGroup("done")} label="Done & declined" />
    </div>
  );
}

// Variant B: one question per row, whose move is it. The owner's own moves
// come first, most urgent at the top, each with the one thing to do.
function WhoseMove({ rows }: { rows: BoardRow[] }) {
  const yours = rows.filter((row) => row.move === "yours").sort((x, y) => y.urgency - x.urgency);
  const theirs = rows
    .filter((row) => row.move === "theirs")
    .sort((x, y) => x.at - y.at);
  const done = rows.filter((row) => row.move === "none");
  return (
    <div className="space-y-10">
      <Section title="Your move" count={yours.length} totalCents={null}>
        {yours.length === 0 ? (
          <p className="px-1 text-slate-400">Nothing for you to do. Nice.</p>
        ) : (
          <RowList rows={yours} showStep />
        )}
      </Section>
      <Section title="Waiting on them" count={theirs.length} totalCents={sumTotals(theirs)}>
        {theirs.length === 0 ? (
          <p className="px-1 text-slate-400">Nobody owes you an answer.</p>
        ) : (
          <RowList rows={theirs} muted />
        )}
      </Section>
      <Folded rows={done} label="Done & declined" />
    </div>
  );
}

function sumTotals(rows: BoardRow[]) {
  return rows.reduce((total, row) => total + row.totalCents, 0);
}

function Section({
  title,
  count,
  totalCents,
  children,
}: {
  title: string;
  count: number;
  totalCents: number | null;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h2 className="text-lg font-semibold text-slate-900">
          {title}
          {count > 0 ? <span className="ml-2 font-normal text-slate-400">{count}</span> : null}
        </h2>
        {totalCents ? (
          <span className="text-sm text-slate-500 tabular-nums">{formatCents(totalCents)}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Folded({ rows, label }: { rows: BoardRow[]; label: string }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-1 text-slate-500 hover:text-slate-800"
      >
        {open ? (
          <ChevronDown aria-hidden className="size-4" />
        ) : (
          <ChevronRight aria-hidden className="size-4" />
        )}
        {label} <span className="text-slate-400">{rows.length}</span>
      </button>
      {open ? <RowList rows={rows} muted /> : null}
    </section>
  );
}

function RowList({
  rows,
  showStep = false,
  muted = false,
}: {
  rows: BoardRow[];
  showStep?: boolean;
  muted?: boolean;
}) {
  return (
    <ol className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/5">
      {rows.map((row) => (
        <li key={row.proposalId}>
          <Link
            href={`/proposals/${row.proposalId}`}
            className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-amber-50/40 md:px-5"
          >
            <span className="min-w-0 flex-1 space-y-0.5">
              <span
                className={cn(
                  "block truncate text-[15px] font-medium",
                  muted ? "text-slate-700" : "text-slate-900",
                )}
              >
                {row.customerName}
              </span>
              <span className="block truncate text-sm text-slate-500">
                {[row.street, row.title].filter(Boolean).join(" · ")}
              </span>
              <Hint row={row} />
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={cn(
                  "text-base font-semibold tabular-nums",
                  muted ? "text-slate-600" : "text-slate-900",
                )}
              >
                {row.totalCents ? formatCents(row.totalCents) : "—"}
              </span>
              {showStep && row.nextStep ? (
                <span className="text-sm font-medium whitespace-nowrap text-amber-700">
                  {row.nextStep} →
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Hint({ row }: { row: BoardRow }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm",
        row.tone === "attention" && "font-medium text-red-700",
        row.tone === "nudge" && "text-amber-800",
        row.tone === "good" && "text-emerald-700",
        row.tone === "quiet" && "text-slate-500",
      )}
    >
      {row.tone !== "quiet" ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            row.tone === "attention" && "bg-red-500",
            row.tone === "nudge" && "bg-amber-500",
            row.tone === "good" && "bg-emerald-500",
          )}
        />
      ) : null}
      {row.hint}
    </span>
  );
}
