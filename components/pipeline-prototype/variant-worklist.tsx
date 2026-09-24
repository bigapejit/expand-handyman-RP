"use client";

// PROTOTYPE variant B, "Worklist": no columns. One list, sorted so what needs
// you is on top, with the stage as a chip on the row and a filter strip to
// narrow to one stage. Built around the next step: each row says what you
// mean to do, and you work the list top to bottom. Click a row for the panel.

import { ArrowRight, Inbox, Plus } from "lucide-react";
import { useState } from "react";

import { IndexEmptyState } from "@/components/index-row";
import { AttentionFlag, SourceBadge, StageChip } from "@/components/pipeline-prototype/bits";
import { DealDetail } from "@/components/pipeline-prototype/deal-detail";
import { NewDealDialog } from "@/components/pipeline-prototype/new-deal-dialog";
import { useDeals } from "@/components/pipeline-prototype/store";
import { SidePanel, useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  attention,
  isOpen,
  lastComment,
  money,
  type Deal,
  type Stage,
} from "@/lib/pipeline-prototype";
import { duration, timeAgo } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

type Filter = "all" | Stage | "closed";

// Stage order for a tie: later stages are closer to money, so they go first.
const rank = (stage: Stage) => OPEN_STAGES.indexOf(stage);

export function VariantWorklist() {
  const { deals, now } = useDeals();
  const { openId, open, close } = useSidePanel("deal");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const openDeal = deals.find((d) => d.id === openId);

  const openDeals = deals.filter((d) => isOpen(d.stage));
  const closedDeals = deals.filter((d) => !isOpen(d.stage));
  const shown = (filter === "closed" ? closedDeals : filter === "all" ? openDeals : openDeals.filter((d) => d.stage === filter))
    .slice()
    .sort((a, b) => {
      const fa = attention(a, now) ? 1 : 0;
      const fb = attention(b, now) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      if (a.stage !== b.stage) return rank(b.stage) - rank(a.stage);
      return a.stageChangedAt - b.stageChangedAt;
    });
  const flagged = openDeals.filter((d) => attention(d, now)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar -mx-8 flex gap-1.5 overflow-x-auto px-8 sm:mx-0 sm:flex-wrap sm:px-0">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All open <Count n={openDeals.length} />
          </FilterChip>
          {OPEN_STAGES.map((stage) => {
            const n = openDeals.filter((d) => d.stage === stage).length;
            return (
              <FilterChip key={stage} active={filter === stage} onClick={() => setFilter(stage)}>
                {STAGE_LABELS[stage]} <Count n={n} />
              </FilterChip>
            );
          })}
          <FilterChip active={filter === "closed"} onClick={() => setFilter("closed")} muted>
            Closed <Count n={closedDeals.length} />
          </FilterChip>
        </div>
        <span className="flex-1" />
        <Button size="lg" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden /> New deal
        </Button>
      </div>

      {filter === "all" && flagged ? (
        <p className="text-sm text-slate-500">
          <span className="font-medium text-amber-800">{flagged} need you</span> · sorted to the top
        </p>
      ) : null}

      {shown.length === 0 ? (
        <IndexEmptyState icon={Inbox} title="Nothing here">
          {filter === "closed" ? "Won and Lost deals land here." : "Add a deal or wait for a Thumbtack lead."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((deal) => (
            <Row key={deal.id} deal={deal} now={now} onOpen={() => open(deal.id)} />
          ))}
        </ul>
      )}

      {openDeal ? (
        <SidePanel
          title={openDeal.customerName}
          description={
            <span className="flex flex-wrap items-center gap-1.5">
              <span>{openDeal.title}</span>
              <span aria-hidden>·</span>
              <SourceBadge source={openDeal.source} />
            </span>
          }
          onClose={close}
        >
          <div className="pt-5">
            <DealDetail deal={openDeal} />
          </div>
        </SidePanel>
      ) : null}

      {adding ? <NewDealDialog onClose={() => setAdding(false)} onCreated={(deal) => open(deal.id)} /> : null}
    </div>
  );
}

function Row({ deal, now, onOpen }: { deal: Deal; now: number; onOpen: () => void }) {
  const flag = attention(deal, now);
  const note = lastComment(deal);
  const unread = deal.lead?.unread;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "grid w-full gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-slate-50 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center",
          flag && "border-l-2 border-amber-400",
        )}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className={cn("truncate text-slate-900", unread ? "font-semibold" : "font-medium")}>{deal.customerName}</span>
            <SourceBadge source={deal.source} compact />
            {unread ? <span role="img" aria-label="Unread" className="size-2 shrink-0 rounded-full bg-sky-500 ring-2 ring-sky-100" /> : null}
          </p>
          <p className="truncate text-sm text-slate-600">
            {deal.title}
            {deal.site ? <span className="text-slate-400"> · {deal.site}</span> : null}
          </p>
        </div>
        <div className="min-w-0 text-sm">
          {deal.nextStep ? (
            <p className="flex items-center gap-1.5 truncate text-slate-900">
              <ArrowRight aria-hidden className="size-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{deal.nextStep}</span>
            </p>
          ) : note ? (
            <p className="truncate text-slate-500">
              <span className="text-slate-400">Note: </span>
              {note.text}
            </p>
          ) : (
            <p className="text-slate-400">No next step</p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <AttentionFlag reason={flag} />
            {!flag ? (
              <span suppressHydrationWarning>
                {isOpen(deal.stage) ? `In ${STAGE_LABELS[deal.stage]} ${duration(now - deal.stageChangedAt)}` : timeAgo(deal.stageChangedAt, now)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          {deal.valueCents ? <span className="text-sm text-slate-500 tabular-nums">{money(deal.valueCents)}</span> : null}
          <StageChip stage={deal.stage} />
        </div>
      </button>
    </li>
  );
}

function FilterChip({
  active,
  muted = false,
  onClick,
  children,
}: {
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition",
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
        muted && !active && "text-slate-500",
      )}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-xs opacity-70 tabular-nums">{n}</span>;
}
