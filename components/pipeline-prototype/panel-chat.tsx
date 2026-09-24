"use client";

// PROTOTYPE panel 1, "Chat": the deal reads like a message thread. A stage
// stepper pinned at the top, the next step as a strip under it, then one
// feed with day dividers (customer messages left, your Thumbtack replies and
// notes right), and a one-line composer pinned at the bottom. Enter adds.

import { ArrowRight, Check, ExternalLink, Pencil, SendHorizontal, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { SourceBadge } from "@/components/pipeline-prototype/bits";
import { clock, firstName, groupByDay, useTimeline } from "@/components/pipeline-prototype/panel-shared";
import { useDeals } from "@/components/pipeline-prototype/store";
import { SidePanel } from "@/components/side-panel";
import { Input } from "@/components/ui/input";
import { OPEN_STAGES, STAGE_LABELS, isOpen, money, type Activity, type Deal, type Stage } from "@/lib/pipeline-prototype";
import { conversationUrl } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

export function PanelChat({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { now, setStage, addComment, setNextStep, completeNextStep } = useDeals();
  const timeline = useTimeline(deal);
  const groups = groupByDay(timeline, now);
  const name = firstName(deal.customerName);

  return (
    <SidePanel
      title={deal.customerName}
      description={
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-slate-700">{deal.title}</span>
          {deal.site ? (
            <>
              <span aria-hidden>·</span>
              <span>{deal.site}</span>
            </>
          ) : null}
          {deal.valueCents ? (
            <>
              <span aria-hidden>·</span>
              <span>{money(deal.valueCents)}</span>
            </>
          ) : null}
          <SourceBadge source={deal.source} compact />
        </span>
      }
      onClose={onClose}
    >
      <div className="-mx-6 flex min-h-full flex-col">
        <Stepper stage={deal.stage} onPick={(s) => setStage(deal.id, s)} />
        <NextStrip
          value={deal.nextStep}
          onSave={(t) => setNextStep(deal.id, t)}
          onDone={() => completeNextStep(deal.id)}
        />

        <div className="flex-1 space-y-5 px-6 py-5">
          {deal.lead?.description ? (
            <div className="rounded-xl border border-dashed bg-slate-50 px-4 py-3 text-sm">
              <p className="mb-1 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                {name} asked on Thumbtack
              </p>
              <p className="whitespace-pre-wrap text-slate-800">{deal.lead.description}</p>
            </div>
          ) : null}
          {groups.map((group) => (
            <section key={group.label} className="space-y-2.5">
              <p className="flex items-center gap-3 text-[11px] font-medium text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                {group.label}
                <span className="h-px flex-1 bg-slate-200" />
              </p>
              {group.items.map((item, i) => (
                <Bubble key={`${item.kind}-${item.at}-${i}`} item={item} name={name} />
              ))}
            </section>
          ))}
        </div>

        <Composer
          onAdd={(text) => addComment(deal.id, text)}
          thumbtack={deal.lead ? conversationUrl(deal.lead.negotiationId) : null}
        />
      </div>
    </SidePanel>
  );
}

function Stepper({ stage, onPick }: { stage: Stage; onPick: (s: Stage) => void }) {
  const at = OPEN_STAGES.indexOf(stage);
  const closed = !isOpen(stage);
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-white/95 px-4 py-2 backdrop-blur">
      <ol className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
        {OPEN_STAGES.map((s, i) => {
          const done = !closed && i < at;
          const current = s === stage;
          return (
            <li key={s} className="flex items-center">
              <button
                type="button"
                onClick={() => onPick(s)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition",
                  current ? "bg-slate-900 text-white" : done ? "text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                )}
              >
                {done ? <Check aria-hidden className="size-3" /> : null}
                {STAGE_LABELS[s]}
              </button>
              {i < OPEN_STAGES.length - 1 ? <span aria-hidden className="text-slate-300">›</span> : null}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => onPick("won")}
        className={cn(
          "rounded-full px-2.5 py-1 text-xs font-medium transition",
          stage === "won" ? "bg-emerald-600 text-white" : "text-emerald-700 hover:bg-emerald-50",
        )}
      >
        Won
      </button>
      <button
        type="button"
        onClick={() => onPick("lost")}
        className={cn(
          "rounded-full px-2.5 py-1 text-xs font-medium transition",
          stage === "lost" ? "bg-slate-600 text-white" : "text-slate-500 hover:bg-slate-100",
        )}
      >
        Lost
      </button>
    </div>
  );
}

function NextStrip({ value, onSave, onDone }: { value?: string; onSave: (t: string) => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  if (editing)
    return (
      <form
        className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft.trim());
          setEditing(false);
        }}
      >
        <ArrowRight aria-hidden className="size-4 shrink-0 text-amber-700" />
        <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What's next?" className="h-8 bg-white" />
        <button type="submit" className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-medium text-white">
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="text-amber-700">
          <X className="size-4" />
        </button>
      </form>
    );
  return (
    <div className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm">
      <ArrowRight aria-hidden className="size-4 shrink-0 text-amber-700" />
      {value ? (
        <>
          <span className="min-w-0 flex-1 truncate text-amber-950">
            <span className="text-amber-700/70">Next: </span>
            {value}
          </span>
          <button
            type="button"
            onClick={onDone}
            className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
          >
            <Check className="size-3" /> Done
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            aria-label="Edit next step"
            className="rounded-md p-1 text-amber-700 hover:bg-amber-100"
          >
            <Pencil className="size-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="flex-1 text-left text-amber-800/70 hover:text-amber-900"
        >
          Set a next step…
        </button>
      )}
    </div>
  );
}

function Bubble({ item, name }: { item: Activity; name: string }) {
  if (item.kind === "message") {
    const mine = item.from === "business";
    return (
      <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
            mine ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md bg-slate-100 text-slate-900",
          )}
        >
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
        <p className="mt-0.5 px-1 text-[11px] text-slate-400">
          {mine ? "You" : name} on Thumbtack · {clock(item.at)}
        </p>
      </div>
    );
  }
  if (item.kind === "comment")
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm text-amber-950">
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
        <p className="mt-0.5 px-1 text-[11px] text-slate-400">Note · {clock(item.at)}</p>
      </div>
    );
  if (item.kind === "done")
    return (
      <p className="text-center text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">
          <Check className="size-3" /> Did: {item.text}
        </span>{" "}
        {clock(item.at)}
      </p>
    );
  if (item.kind === "stage")
    return (
      <p className="text-center text-[11px] text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-0.5">
          Moved to <span className="font-medium text-slate-700">{STAGE_LABELS[item.to]}</span>
        </span>{" "}
        {clock(item.at)}
      </p>
    );
  return (
    <p className="text-center text-[11px] text-slate-500">
      {item.text} · {clock(item.at)}
    </p>
  );
}

function Composer({ onAdd, thumbtack }: { onAdd: (t: string) => void; thumbtack: string | null }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className="sticky bottom-0 border-t bg-white px-4 py-3">
      <div className="flex items-end gap-2 rounded-2xl border bg-white px-3 py-2 focus-within:border-slate-400">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder="Add a note…"
          className="field-sizing-content max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim()}
          aria-label="Add note"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-amber-500 text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          <SendHorizontal className="size-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-slate-400">
        <span>Notes are only yours. Enter to add.</span>
        {thumbtack ? (
          <a href={thumbtack} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[#007fae] hover:underline">
            <ExternalLink className="size-3" /> Reply on Thumbtack
          </a>
        ) : null}
      </div>
    </div>
  );
}
