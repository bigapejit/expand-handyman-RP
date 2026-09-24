"use client";

// PROTOTYPE variant C, "Workbench": an inbox. A narrow list of deals on the
// left, ordered by who needs you; the selected deal fills the right, always
// open, with a stage stepper across the top and the timeline and note box
// below. No side panel, no columns: the deal is the page.

import { Check, Inbox, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { AttentionFlag, SourceBadge } from "@/components/pipeline-prototype/bits";
import { DealDetail } from "@/components/pipeline-prototype/deal-detail";
import { NewDealDialog } from "@/components/pipeline-prototype/new-deal-dialog";
import { useDeals } from "@/components/pipeline-prototype/store";
import { useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  attention,
  isOpen,
  money,
  type Deal,
  type Stage,
} from "@/lib/pipeline-prototype";
import { timeAgo } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

const stageDot: Record<Stage, string> = {
  new: "bg-sky-400",
  talking: "bg-amber-400",
  booked: "bg-teal-400",
  estimating: "bg-orange-400",
  quoted: "bg-violet-400",
  won: "bg-emerald-500",
  lost: "bg-slate-300",
};

export function VariantWorkbench() {
  const { deals, now, setStage } = useDeals();
  const { openId, open } = useSidePanel("deal");
  const [view, setView] = useState<"open" | "closed">("open");
  const [adding, setAdding] = useState(false);

  const list = deals
    .filter((d) => (view === "open" ? isOpen(d.stage) : !isOpen(d.stage)))
    .sort((a, b) => {
      const fa = attention(a, now) ? 1 : 0;
      const fb = attention(b, now) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return b.stageChangedAt - a.stageChangedAt;
    });

  const selected = deals.find((d) => d.id === openId) ?? list[0];

  // Land on the first deal, so the right pane is never empty.
  useEffect(() => {
    if (!openId && list[0]) open(list[0].id);
  }, [openId, list, open]);

  const openValue = deals.filter((d) => isOpen(d.stage)).reduce((s, d) => s + (d.valueCents ?? 0), 0);

  return (
    <div className="-mx-8 -mb-8 flex min-h-[calc(100vh-14rem)] flex-col overflow-hidden border-t bg-white lg:mx-0 lg:mb-0 lg:flex-row lg:rounded-2xl lg:border">
      <aside className="flex w-full shrink-0 flex-col border-b lg:w-80 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <span className="flex-1" />
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" aria-hidden /> New
          </Button>
        </div>
        <p className="border-b bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          {list.length} {view} · {money(openValue)} in play
        </p>
        {list.length === 0 ? (
          <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">
            <div>
              <Inbox className="mx-auto size-6 text-slate-400" />
              <p className="mt-2">Nothing {view}.</p>
            </div>
          </div>
        ) : (
          <ul className="no-scrollbar flex divide-x overflow-x-auto lg:max-h-[calc(100vh-18rem)] lg:flex-col lg:divide-x-0 lg:divide-y lg:overflow-y-auto">
            {list.map((deal) => (
              <ListItem key={deal.id} deal={deal} now={now} selected={deal.id === selected?.id} onSelect={() => open(deal.id)} />
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0 flex-1">
        {selected ? (
          <>
            <Stepper stage={selected.stage} onPick={(stage) => setStage(selected.id, stage)} />
            <div className="p-6">
              <DealDetail deal={selected} header stagePicker={false} />
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center p-10 text-sm text-slate-500">Pick a deal on the left.</div>
        )}
      </section>

      {adding ? <NewDealDialog onClose={() => setAdding(false)} onCreated={(deal) => open(deal.id)} /> : null}
    </div>
  );
}

function ListItem({ deal, now, selected, onSelect }: { deal: Deal; now: number; selected: boolean; onSelect: () => void }) {
  const flag = attention(deal, now);
  const unread = deal.lead?.unread;
  return (
    <li className="w-64 shrink-0 lg:w-auto">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors hover:bg-slate-50",
          selected && "bg-slate-100 hover:bg-slate-100",
        )}
      >
        <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", stageDot[deal.stage])} title={STAGE_LABELS[deal.stage]} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm text-slate-900", unread ? "font-semibold" : "font-medium")}>
              {deal.customerName}
            </span>
            <span suppressHydrationWarning className="shrink-0 text-[11px] text-slate-500 tabular-nums">
              {timeAgo(deal.stageChangedAt, now)}
            </span>
          </span>
          <span className="block truncate text-xs text-slate-600">{deal.title}</span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">{STAGE_LABELS[deal.stage]}</span>
            {deal.source === "thumbtack" ? <SourceBadge source="thumbtack" compact /> : null}
            <span className="flex-1" />
            {flag ? <AttentionFlag reason={flag} /> : deal.valueCents ? <span className="text-[11px] text-slate-500 tabular-nums">{money(deal.valueCents)}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

// The five open stages as chevrons across the top; the current one is dark,
// the ones behind it ticked. Won and Lost sit apart at the right end.
function Stepper({ stage, onPick }: { stage: Stage; onPick: (stage: Stage) => void }) {
  const at = OPEN_STAGES.indexOf(stage);
  const closed = !isOpen(stage);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
      <ol className="no-scrollbar flex max-w-full items-center overflow-x-auto">
        {OPEN_STAGES.map((s, i) => {
          const done = !closed && i < at;
          const current = s === stage;
          return (
            <li key={s} className="flex items-center">
              <button
                type="button"
                onClick={() => onPick(s)}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition",
                  current
                    ? "bg-slate-900 text-white"
                    : done
                      ? "text-slate-700 hover:bg-white"
                      : "text-slate-400 hover:bg-white hover:text-slate-700",
                )}
              >
                {done ? <Check aria-hidden className="size-3" /> : null}
                {STAGE_LABELS[s]}
              </button>
              {i < OPEN_STAGES.length - 1 ? <span aria-hidden className="mx-0.5 text-slate-300">›</span> : null}
            </li>
          );
        })}
      </ol>
      <span className="flex-1" />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPick("won")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition",
            stage === "won" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-200 text-emerald-800 hover:bg-emerald-50",
          )}
        >
          Won
        </button>
        <button
          type="button"
          onClick={() => onPick("lost")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition",
            stage === "lost" ? "border-slate-600 bg-slate-600 text-white" : "border-slate-200 text-slate-600 hover:bg-white",
          )}
        >
          Lost
        </button>
      </div>
    </div>
  );
}
