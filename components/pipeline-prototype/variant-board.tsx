"use client";

// PROTOTYPE variant A, "Board": today's Thumbtack board, widened to every
// deal. A column per open stage, a card per deal with its source badge, drag
// between columns, Won/Lost as drop zones, Closed behind a toggle. Click a
// card for the side panel.

import { Inbox, Plus, Trophy, XCircle } from "lucide-react";
import { useState, type DragEvent } from "react";

import { IndexEmptyState } from "@/components/index-row";
import { AttentionFlag, SourceBadge, StageChip, dayFormat } from "@/components/pipeline-prototype/bits";
import { NewDealDialog } from "@/components/pipeline-prototype/new-deal-dialog";
import { PanelCards } from "@/components/pipeline-prototype/panel-cards";
import { PanelChat } from "@/components/pipeline-prototype/panel-chat";
import { PanelJournal } from "@/components/pipeline-prototype/panel-journal";
import { PanelQuick } from "@/components/pipeline-prototype/panel-quick";
import { useDeals } from "@/components/pipeline-prototype/store";
import { useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  attention,
  isOpen,
  lastComment,
  lastMessage,
  money,
  type Deal,
  type Stage,
} from "@/lib/pipeline-prototype";
import { timeAgo } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

type Dragging = { id: string; stage: Stage } | null;

/** Which panel design opens over the board: see panel-chat/cards/journal. */
export type PanelVariant = "1" | "2" | "3" | "4";

export function VariantBoard({ panel = "4" }: { panel?: PanelVariant }) {
  const { deals, now, setStage } = useDeals();
  const { openId, open, close } = useSidePanel("deal");
  const [view, setView] = useState<"open" | "closed">("open");
  const [dragging, setDragging] = useState<Dragging>(null);
  const [adding, setAdding] = useState(false);

  const openDeal = deals.find((d) => d.id === openId);
  const closed = deals.filter((d) => !isOpen(d.stage));
  const openCount = deals.length - closed.length;
  const openValue = deals.filter((d) => isOpen(d.stage)).reduce((sum, d) => sum + (d.valueCents ?? 0), 0);

  const drop = (stage: Stage) => (event: DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragging?.id;
    setDragging(null);
    if (id && dragging?.stage !== stage) setStage(id, stage);
  };
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
            { value: "open", label: `Open · ${openCount}` },
            { value: "closed", label: `Closed · ${closed.length}` },
          ]}
        />
        <p className="text-sm text-slate-500">
          {money(openValue)} in play
        </p>
        <span className="flex-1" />
        <Button size="lg" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden /> New deal
        </Button>
      </div>

      {view === "open" ? (
        <>
          <div className="no-scrollbar -mx-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-8 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
            {OPEN_STAGES.map((stage) => {
              const inColumn = deals.filter((d) => d.stage === stage);
              const value = inColumn.reduce((s, d) => s + (d.valueCents ?? 0), 0);
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
                    {value ? <span className="text-xs text-slate-500 tabular-nums">{money(value)}</span> : null}
                  </header>
                  {inColumn.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                      {receiving ? `Drop to move to ${STAGE_LABELS[stage]}` : "Nothing here"}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {inColumn.map((deal) => (
                        <li key={deal.id}>
                          <DealCard
                            deal={deal}
                            now={now}
                            lifted={dragging?.id === deal.id}
                            onOpen={() => open(deal.id)}
                            onLift={() => setDragging({ id: deal.id, stage: deal.stage })}
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
      ) : closed.length === 0 ? (
        <IndexEmptyState icon={Inbox} title="Nothing closed yet">
          Won and Lost deals land here.
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {closed.map((deal) => (
            <li key={deal.id}>
              <button
                type="button"
                onClick={() => open(deal.id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{deal.customerName}</p>
                  <p className="truncate text-sm text-slate-500">{deal.title}</p>
                </div>
                <SourceBadge source={deal.source} compact />
                {deal.valueCents ? <span className="text-sm text-slate-500 tabular-nums">{money(deal.valueCents)}</span> : null}
                <span className="hidden text-sm text-slate-500 sm:inline">{dayFormat.format(new Date(deal.stageChangedAt))}</span>
                <StageChip stage={deal.stage} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {openDeal ? (
        panel === "4" ? (
          <PanelQuick key={openDeal.id} deal={openDeal} onClose={close} />
        ) : panel === "2" ? (
          <PanelCards key={openDeal.id} deal={openDeal} onClose={close} />
        ) : panel === "3" ? (
          <PanelJournal key={openDeal.id} deal={openDeal} onClose={close} />
        ) : (
          <PanelChat key={openDeal.id} deal={openDeal} onClose={close} />
        )
      ) : null}

      {adding ? <NewDealDialog onClose={() => setAdding(false)} onCreated={(deal) => open(deal.id)} /> : null}
    </div>
  );
}

function DealCard({
  deal,
  now,
  lifted,
  onOpen,
  onLift,
  onSettle,
}: {
  deal: Deal;
  now: number;
  lifted: boolean;
  onOpen: () => void;
  onLift: () => void;
  onSettle: () => void;
}) {
  const unread = deal.lead?.unread;
  const note = lastComment(deal);
  const msg = lastMessage(deal);
  // The freshest thing said on the deal: a note beats an older message.
  const snippet =
    note && (!msg || note.at >= msg.at)
      ? { prefix: "Note: ", text: note.text, tone: "text-slate-600" }
      : msg
        ? { prefix: msg.from === "business" ? "You: " : "", text: msg.text, tone: unread ? "text-slate-900" : "text-slate-600" }
        : deal.lead?.description
          ? { prefix: "", text: deal.lead.description, tone: "text-slate-600" }
          : null;
  const flag = attention(deal, now);

  return (
    <button
      type="button"
      draggable
      onClick={onOpen}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", deal.id);
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
        {unread ? <span role="img" aria-label="Unread" className="size-2 shrink-0 rounded-full bg-sky-500 ring-2 ring-sky-100" /> : null}
        <span suppressHydrationWarning className="shrink-0 text-xs text-slate-500 tabular-nums">
          {timeAgo(deal.createdAt, now)}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-sm text-slate-700">{deal.title}</span>
      {deal.site ? <span className="block truncate text-xs text-slate-500">{deal.site}</span> : null}
      {snippet ? (
        <span className={cn("mt-2 line-clamp-2 text-sm", snippet.tone)}>
          {snippet.prefix ? <span className="text-slate-400">{snippet.prefix}</span> : null}
          {snippet.text}
        </span>
      ) : null}
      <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <SourceBadge source={deal.source} compact />
        {deal.valueCents ? (
          <span className="rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600 tabular-nums">
            {money(deal.valueCents)}
          </span>
        ) : null}
        <span className="flex-1" />
        <AttentionFlag reason={flag} />
      </span>
      {deal.nextStep ? (
        <span className="mt-2 block truncate text-xs text-slate-500">
          <span className="text-slate-400">Next: </span>
          {deal.nextStep}
        </span>
      ) : null}
    </button>
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
        tone === "green" ? "border-green-300 bg-green-50 text-green-800" : "border-slate-300 bg-slate-50 text-slate-600",
      )}
    >
      <Icon aria-hidden className="size-4" />
      Drop here: {label}
    </div>
  );
}
