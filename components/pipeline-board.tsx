"use client";

import type { FunctionReturnType } from "convex/server";
import { Inbox, Plus, Trophy, XCircle } from "lucide-react";
import { useState, type DragEvent } from "react";

import { AttentionFlag, SourceBadge, StageChip } from "@/components/deal-chips";
import { IndexEmptyState } from "@/components/index-row";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useNow } from "@/hooks/use-now";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  attention,
  dealValueCents,
  firstLine,
  isOpen,
  money,
  type Stage,
} from "@/lib/pipeline";
import { timeAgo } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

/** One deal on the **Pipeline**, as `deals.board` returns it. */
export type DealRow = FunctionReturnType<typeof api.deals.board>[number];

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});

// The card being dragged, as the drop targets read it. Kept in state rather
// than only on the drag's data, because `dragover` cannot read the data and
// the columns need to know which stage the card is leaving.
type Dragging = { dealId: Id<"deals">; stage: Stage } | null;

const total = (deals: DealRow[]) => deals.reduce((sum, deal) => sum + (dealValueCents(deal) ?? 0), 0);

// The **Pipeline**: open deals in a column per stage, and the Won and Lost
// ones behind Closed as a flat list, the latest closed first. `deals` comes
// newest first. A card is dragged between columns, or onto Won or Lost, which
// appear only while a card is in the air; on a phone, where there is no drag,
// the Quick panel's stage control does the same.
export function PipelineBoard({
  deals,
  onOpen,
  onSetStage,
  onNew,
}: {
  deals: DealRow[];
  onOpen: (dealId: Id<"deals">) => void;
  onSetStage: (dealId: Id<"deals">, stage: Stage) => void;
  onNew: () => void;
}) {
  const [view, setView] = useState<"open" | "closed">("open");
  const [dragging, setDragging] = useState<Dragging>(null);
  const now = useNow();
  const open = deals.filter((deal) => isOpen(deal.stage));
  const closed = deals
    .filter((deal) => !isOpen(deal.stage))
    .sort((a, b) => b.stageChangedAt - a.stageChangedAt);

  const drop = (stage: Stage) => (event: DragEvent) => {
    event.preventDefault();
    const dealId = (event.dataTransfer.getData("text/plain") || dragging?.dealId) as
      | Id<"deals">
      | "";
    setDragging(null);
    if (dealId && dragging?.stage !== stage) onSetStage(dealId, stage);
  };
  // Only a drop that would move the card is accepted; the same column is not.
  const allow = (stage: Stage) => (event: DragEvent) => {
    if (dragging && dragging.stage !== stage) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: `Open · ${open.length}` },
            { value: "closed", label: `Closed · ${closed.length}` },
          ]}
        />
        <p className="text-sm text-slate-500 tabular-nums">{money(total(open))} in play</p>
        <span className="flex-1" />
        <Button size="lg" onClick={onNew}>
          <Plus data-icon="inline-start" aria-hidden /> New deal
        </Button>
      </div>

      {view === "open" ? (
        deals.length === 0 ? (
          <IndexEmptyState icon={Inbox} title="No deals yet">
            Add one with New deal. Thumbtack leads arrive in New on their own.
          </IndexEmptyState>
        ) : (
          <>
            {/* A phone scrolls the columns sideways; a wide screen shows all five. */}
            <div className="no-scrollbar -mx-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-8 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
              {OPEN_STAGES.map((stage) => {
                const inColumn = open.filter((deal) => deal.stage === stage);
                const value = total(inColumn);
                const receiving = dragging !== null && dragging.stage !== stage;
                return (
                  <section
                    key={stage}
                    aria-label={STAGE_LABELS[stage]}
                    onDragOver={allow(stage)}
                    onDrop={drop(stage)}
                    className={cn(
                      "w-[82%] max-w-sm shrink-0 snap-start rounded-2xl bg-slate-100/80 p-2 transition-colors lg:w-auto lg:max-w-none lg:min-w-0",
                      receiving && "bg-sky-50 ring-2 ring-sky-300 ring-inset",
                    )}
                  >
                    <header className="flex items-center gap-2 px-2 pt-1 pb-2">
                      <h2 className="text-sm font-semibold text-slate-900">{STAGE_LABELS[stage]}</h2>
                      <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500 tabular-nums">
                        {inColumn.length}
                      </span>
                      <span className="flex-1" />
                      {value ? (
                        <span className="text-xs text-slate-500 tabular-nums">{money(value)}</span>
                      ) : null}
                    </header>
                    {inColumn.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                        {receiving ? `Drop to move to ${STAGE_LABELS[stage]}` : "Nothing here"}
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {inColumn.map((deal) => (
                          <li key={deal._id}>
                            <DealCard
                              deal={deal}
                              now={now}
                              lifted={dragging?.dealId === deal._id}
                              onOpen={() => onOpen(deal._id)}
                              onLift={() => setDragging({ dealId: deal._id, stage: deal.stage })}
                              onSettle={() => setDragging(null)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
            {/* Won and Lost have no column: they only appear as somewhere to
                drop the card in the air, so the board stays five wide. */}
            <div
              aria-hidden={dragging === null}
              className={cn(
                "grid grid-cols-2 gap-3 transition-opacity",
                dragging === null ? "pointer-events-none h-0 overflow-hidden opacity-0" : "opacity-100",
              )}
            >
              <DropZone label="Won" icon={Trophy} tone="green" onDragOver={allow("won")} onDrop={drop("won")} />
              <DropZone label="Lost" icon={XCircle} tone="slate" onDragOver={allow("lost")} onDrop={drop("lost")} />
            </div>
          </>
        )
      ) : closed.length === 0 ? (
        <IndexEmptyState icon={Inbox} title="Nothing closed yet">
          Won and Lost deals land here.
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {closed.map((deal) => {
            const value = dealValueCents(deal);
            return (
              <li key={deal._id}>
                <button
                  type="button"
                  onClick={() => onOpen(deal._id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{deal.customerName}</p>
                    <p className="truncate text-sm text-slate-500">{deal.title}</p>
                  </div>
                  <SourceBadge source={deal.source} compact />
                  {value ? <span className="text-sm text-slate-500 tabular-nums">{money(value)}</span> : null}
                  <span className="hidden text-sm text-slate-500 sm:inline">
                    {dayFormat.format(new Date(deal.stageChangedAt))}
                  </span>
                  <StageChip stage={deal.stage} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DropZone({
  label,
  icon: Icon,
  tone,
  onDragOver,
  onDrop,
}: {
  label: string;
  icon: typeof Trophy;
  tone: "green" | "slate";
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-3 py-5 text-sm font-medium",
        tone === "green"
          ? "border-green-300 bg-green-50 text-green-800"
          : "border-slate-300 bg-slate-50 text-slate-600",
      )}
    >
      <Icon aria-hidden className="size-4" />
      Drop here: {label}
    </div>
  );
}

// One deal on the board: who, how old, the job and where, the first line of
// the owner's **Notes** (or, on a Thumbtack deal with none yet, what they
// asked), then its source, its figure and, when it wants looking at, why.
function DealCard({
  deal,
  now,
  lifted,
  onOpen,
  onLift,
  onSettle,
}: {
  deal: DealRow;
  now: number;
  lifted: boolean;
  onOpen: () => void;
  onLift: () => void;
  onSettle: () => void;
}) {
  const unread = deal.lead?.unread ?? false;
  const snippet = firstLine(deal.notes) || firstLine(deal.lead?.description ?? "");
  const value = dealValueCents(deal);
  // The site once picked; until then, where Thumbtack said the job is.
  const where = deal.site?.line ?? deal.lead?.addressLine;
  return (
    <button
      type="button"
      draggable
      onClick={onOpen}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", deal._id);
        event.dataTransfer.effectAllowed = "move";
        onLift();
      }}
      onDragEnd={onSettle}
      className={cn(
        "block w-full cursor-grab rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition hover:border-slate-300 hover:shadow-sm active:cursor-grabbing",
        lifted && "opacity-40",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-slate-900", unread ? "font-semibold" : "font-medium")}>
          {deal.customerName}
        </span>
        {unread ? (
          <span role="img" aria-label="Unread" className="size-2 shrink-0 rounded-full bg-sky-500 ring-2 ring-sky-100" />
        ) : null}
        {/* The server's clock and the browser's may straddle a minute. */}
        <span suppressHydrationWarning className="shrink-0 text-xs text-slate-500 tabular-nums">
          {timeAgo(deal.createdAt, now)}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-sm text-slate-700">{deal.title}</span>
      {where ? <span className="block truncate text-xs text-slate-500">{where}</span> : null}
      {snippet ? <span className="mt-2 line-clamp-2 text-sm text-slate-600">{snippet}</span> : null}
      <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <SourceBadge source={deal.source} compact />
        {value ? (
          <span className="rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600 tabular-nums">
            {money(value)}
          </span>
        ) : null}
        <span className="flex-1" />
        <AttentionFlag reason={attention(deal, now)} />
      </span>
    </button>
  );
}
