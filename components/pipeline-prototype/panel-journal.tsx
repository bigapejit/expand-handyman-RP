"use client";

// PROTOTYPE panel 3, "Journal": the quietest one. The stage is a chip in the
// header that opens a menu; the next step is one line under the title; the
// note box sits at the top and the history reads down the page like a diary,
// grouped by day, with Thumbtack messages as quotes and stage moves as small
// grey lines. No cards, no timeline rail.

import { ArrowRight, Check, ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SourceBadge } from "@/components/pipeline-prototype/bits";
import { clock, firstName, groupByDay, stageTone, useTimeline } from "@/components/pipeline-prototype/panel-shared";
import { useDeals } from "@/components/pipeline-prototype/store";
import { SidePanel } from "@/components/side-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { STAGES, STAGE_LABELS, isOpen, money, type Activity, type Deal, type Stage } from "@/lib/pipeline-prototype";
import { conversationUrl } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

export function PanelJournal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { now, setStage, addComment, setNextStep, completeNextStep } = useDeals();
  const timeline = useTimeline(deal);
  const groups = groupByDay(timeline, now).reverse();
  const name = firstName(deal.customerName);

  return (
    <SidePanel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{deal.customerName}</span>
          <StageMenu stage={deal.stage} onPick={(s) => setStage(deal.id, s)} />
        </span>
      }
      description={deal.title}
      onClose={onClose}
    >
      <div className="max-w-2xl space-y-6 pt-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
          <SourceBadge source={deal.source} compact />
          {deal.site ? <span>{deal.site}</span> : <span className="text-slate-400">No site yet</span>}
          {deal.valueCents ? (
            <>
              <span aria-hidden>·</span>
              <span>{deal.proposal ? `${deal.proposal.code} ${money(deal.valueCents)}` : `~${money(deal.valueCents)}`}</span>
            </>
          ) : null}
          {deal.customerId ? (
            <>
              <span aria-hidden>·</span>
              <Link href={`/customers/${deal.customerId}`} className="hover:underline">
                Customer
              </Link>
            </>
          ) : null}
          {deal.lead ? (
            <>
              <span aria-hidden>·</span>
              <a href={conversationUrl(deal.lead.negotiationId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#007fae] hover:underline">
                Reply on Thumbtack <ExternalLink className="size-3" />
              </a>
            </>
          ) : null}
        </p>

        <NextLine value={deal.nextStep} onSave={(t) => setNextStep(deal.id, t)} onDone={() => completeNextStep(deal.id)} />

        <Writer onAdd={(t) => addComment(deal.id, t)} />

        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{group.label}</h3>
              <ul className="space-y-2.5">
                {group.items
                  .slice()
                  .reverse()
                  .map((item, i) => (
                    <Entry key={`${item.kind}-${item.at}-${i}`} item={item} name={name} />
                  ))}
              </ul>
            </section>
          ))}
        </div>

        {deal.lead?.description ? (
          <blockquote className="border-l-2 border-slate-200 pl-3 text-sm text-slate-600">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Original request</p>
            <p className="whitespace-pre-wrap">{deal.lead.description}</p>
          </blockquote>
        ) : null}
      </div>
    </SidePanel>
  );
}

function StageMenu({ stage, onPick }: { stage: Stage; onPick: (s: Stage) => void }) {
  const [open, setOpen] = useState(false);
  const tone = stageTone[stage];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", tone.bg, tone.text)}
          />
        }
      >
        {STAGE_LABELS[stage]}
        <ChevronDown aria-hidden className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 gap-0.5 p-1.5">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              onPick(s);
              setOpen(false);
            }}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100",
              !isOpen(s) && s === "won" && "mt-1 border-t pt-2.5",
            )}
          >
            <span className={cn("size-2 rounded-full", stageTone[s].fill)} />
            <span className="flex-1">{STAGE_LABELS[s]}</span>
            {s === stage ? <Check className="size-3.5 text-slate-500" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function NextLine({ value, onSave, onDone }: { value?: string; onSave: (t: string) => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  if (editing)
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft.trim());
          setEditing(false);
        }}
      >
        <ArrowRight aria-hidden className="size-4 shrink-0 text-slate-400" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            onSave(draft.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          placeholder="Next step"
          className="flex-1 border-b border-slate-300 bg-transparent py-0.5 text-base font-medium outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-slate-900"
        />
      </form>
    );
  return (
    <div className="group flex items-center gap-2">
      <ArrowRight aria-hidden className={cn("size-4 shrink-0", value ? "text-slate-900" : "text-slate-300")} />
      <button
        type="button"
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className={cn("flex-1 text-left text-base", value ? "font-medium text-slate-900" : "text-slate-400 hover:text-slate-600")}
      >
        {value ?? "Add a next step"}
      </button>
      {value ? (
        <button
          type="button"
          onClick={onDone}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-slate-500 opacity-60 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 hover:opacity-100"
        >
          <Check className="size-3" /> Done
        </button>
      ) : null}
    </div>
  );
}

function Writer({ onAdd }: { onAdd: (t: string) => void }) {
  const [text, setText] = useState("");
  const save = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  return (
    <div className="border-l-2 border-amber-300 pl-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        rows={1}
        placeholder="Write it down…"
        className="field-sizing-content w-full resize-none bg-transparent py-1 text-sm outline-none placeholder:text-slate-400"
      />
      {text.trim() ? (
        <div className="mt-1 flex items-center gap-3 text-xs">
          <button type="button" onClick={save} className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white">
            Save note
          </button>
          <span className="text-slate-400">Ctrl+Enter</span>
        </div>
      ) : null}
    </div>
  );
}

function Entry({ item, name }: { item: Activity; name: string }) {
  const time = <span className="ml-2 text-[11px] text-slate-400 tabular-nums">{clock(item.at)}</span>;
  if (item.kind === "comment")
    return (
      <li className="text-sm text-slate-900">
        <span className="whitespace-pre-wrap">{item.text}</span>
        {time}
      </li>
    );
  if (item.kind === "message")
    return (
      <li className="border-l-2 border-[#009fd9]/40 pl-3 text-sm text-slate-700">
        <span className="font-medium text-slate-900">{item.from === "business" ? "You" : name}</span>
        <span className="text-slate-400"> on Thumbtack</span>
        {time}
        <p className="whitespace-pre-wrap">{item.text}</p>
      </li>
    );
  if (item.kind === "done")
    return (
      <li className="text-sm text-slate-600">
        <Check aria-hidden className="mr-1 inline size-3.5 text-emerald-600" />
        Did: {item.text}
        {time}
      </li>
    );
  if (item.kind === "stage")
    return (
      <li className="text-xs text-slate-400">
        Moved to {STAGE_LABELS[item.to]}
        {time}
      </li>
    );
  return (
    <li className="text-xs text-slate-400">
      {item.text}
      {time}
    </li>
  );
}
