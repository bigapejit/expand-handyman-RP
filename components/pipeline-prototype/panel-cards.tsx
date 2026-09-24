"use client";

// PROTOTYPE panel 2, "Cards": a progress bar for the stage, then two cards
// side by side (Now: the next step with a Done button; Details: the facts),
// then Notes as a plain dated list, newest first, with the add box at the
// top of the list. Thumbtack messages and stage moves can be hidden.

import { ArrowRight, Check, ExternalLink, MessageSquare, Pencil, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { SourceBadge } from "@/components/pipeline-prototype/bits";
import { clock, dayLabel, firstName, stageTone, useTimeline } from "@/components/pipeline-prototype/panel-shared";
import { useDeals } from "@/components/pipeline-prototype/store";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { OPEN_STAGES, SOURCE_LABELS, STAGE_LABELS, isOpen, money, type Activity, type Deal, type Stage } from "@/lib/pipeline-prototype";
import { conversationUrl } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

export function PanelCards({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { now, setStage, addComment, setNextStep, completeNextStep } = useDeals();
  const timeline = useTimeline(deal);
  const [filter, setFilter] = useState<"all" | "notes">("all");
  const name = firstName(deal.customerName);
  const shown = timeline
    .filter((a) => (filter === "all" ? true : a.kind === "comment" || a.kind === "done"))
    .slice()
    .reverse();

  return (
    <SidePanel
      title={deal.customerName}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-700">{deal.title}</span>
          <SourceBadge source={deal.source} compact />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-4 pt-4">
        <ProgressBar stage={deal.stage} onPick={(s) => setStage(deal.id, s)} />

        <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
          <Card title="Now" tone="amber">
            <NowBody
              value={deal.nextStep}
              onSave={(t) => setNextStep(deal.id, t)}
              onDone={() => completeNextStep(deal.id)}
            />
          </Card>
          <Card title="Details">
            <dl className="space-y-1.5 text-sm">
              <Row label="Site">{deal.site ?? <span className="text-slate-400">Not yet</span>}</Row>
              <Row label="From">{SOURCE_LABELS[deal.source]}</Row>
              {deal.proposal ? (
                <Row label="Proposal">
                  {deal.proposal.code} · <span className="capitalize">{deal.proposal.state}</span>
                  {deal.valueCents ? ` · ${money(deal.valueCents)}` : ""}
                </Row>
              ) : deal.valueCents ? (
                <Row label="Ballpark">{money(deal.valueCents)}</Row>
              ) : null}
              {deal.customerId ? (
                <Row label="Customer">
                  <Link href={`/customers/${deal.customerId}`} className="font-medium hover:underline">
                    Open
                  </Link>
                </Row>
              ) : null}
              {deal.lead ? (
                <Row label="Thumbtack">
                  <a href={conversationUrl(deal.lead.negotiationId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[#007fae] hover:underline">
                    Reply <ExternalLink className="size-3" />
                  </a>
                </Row>
              ) : null}
            </dl>
          </Card>
        </div>

        {deal.lead?.description ? (
          <Card title={`What ${name} asked`}>
            <p className="text-sm whitespace-pre-wrap text-slate-800">{deal.lead.description}</p>
          </Card>
        ) : null}

        <Card
          title="Notes"
          aside={
            <Segmented<"all" | "notes">
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Everything" },
                { value: "notes", label: "Notes only" },
              ]}
            />
          }
        >
          <AddNote onAdd={(t) => addComment(deal.id, t)} />
          <ul className="mt-3 divide-y">
            {shown.length === 0 ? <li className="py-3 text-sm text-slate-400">Nothing yet.</li> : null}
            {shown.map((item, i) => (
              <NoteRow key={`${item.kind}-${item.at}-${i}`} item={item} name={name} now={now} />
            ))}
          </ul>
        </Card>
      </div>
    </SidePanel>
  );
}

// Five blocks in a row; the ones behind the current stage fill dark, the
// current one fills in its colour with its name, the rest stay pale. Won and
// Lost stand apart on the right; a closed deal paints the whole bar.
function ProgressBar({ stage, onPick }: { stage: Stage; onPick: (s: Stage) => void }) {
  const at = OPEN_STAGES.indexOf(stage);
  const closed = !isOpen(stage);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <ol className="flex flex-1 gap-1">
          {OPEN_STAGES.map((s, i) => {
            const done = closed ? true : i < at;
            const current = s === stage;
            return (
              <li key={s} className="flex-1">
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  title={STAGE_LABELS[s]}
                  className={cn(
                    "h-7 w-full rounded-md text-[11px] font-medium transition",
                    current && `${stageTone[s].fill} text-white`,
                    !current && done && (closed ? `${stageTone[stage].fill} text-white/90` : "bg-slate-800 text-white/80 hover:bg-slate-700"),
                    !current && !done && "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600",
                  )}
                >
                  {STAGE_LABELS[s]}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={() => onPick("won")}
          className={cn(
            "h-7 rounded-md border px-2.5 text-[11px] font-medium transition",
            stage === "won" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-200 text-emerald-800 hover:bg-emerald-50",
          )}
        >
          Won
        </button>
        <button
          type="button"
          onClick={() => onPick("lost")}
          className={cn(
            "h-7 rounded-md border px-2.5 text-[11px] font-medium transition",
            stage === "lost" ? "border-slate-500 bg-slate-500 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50",
          )}
        >
          Lost
        </button>
      </div>
      {closed ? <p className="text-xs text-slate-500">{STAGE_LABELS[stage]}. Click a stage to reopen.</p> : null}
    </div>
  );
}

function Card({ title, tone, aside, children }: { title: string; tone?: "amber"; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={cn("rounded-xl border p-4", tone === "amber" ? "border-amber-200 bg-amber-50/60" : "bg-white")}>
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className={cn("text-sm font-semibold", tone === "amber" ? "text-amber-900" : "text-slate-900")}>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-slate-900">{children}</dd>
    </div>
  );
}

function NowBody({ value, onSave, onDone }: { value?: string; onSave: (t: string) => void; onDone: () => void }) {
  const [editing, setEditing] = useState(!value);
  const [draft, setDraft] = useState(value ?? "");
  if (editing || !value)
    return (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onSave(draft.trim());
          setEditing(false);
        }}
      >
        <Input autoFocus={editing && !!value} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What's the next thing to do?" className="h-9 bg-white" />
        <Button type="submit" size="sm" className="h-9" disabled={!draft.trim()}>
          Set
        </Button>
        {value ? (
          <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </form>
    );
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-base font-medium text-amber-950">
        <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-amber-600" />
        {value}
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onDone} className="bg-emerald-600 hover:bg-emerald-600/90">
          <Check data-icon="inline-start" aria-hidden /> Done
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          <Pencil data-icon="inline-start" aria-hidden /> Change
        </Button>
      </div>
    </div>
  );
}

function AddNote({ onAdd }: { onAdd: (t: string) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700"
      >
        <Plus className="size-4" /> Add a note
      </button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text.trim());
        setText("");
        setOpen(false);
      }}
    >
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="What they said, what you measured, what to bring."
        className="min-h-16"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Save note
        </Button>
      </div>
    </form>
  );
}

function NoteRow({ item, name, now }: { item: Activity; name: string; now: number }) {
  const when = `${dayLabel(item.at, now)} ${clock(item.at)}`;
  if (item.kind === "comment")
    return (
      <li className="flex gap-3 py-2.5">
        <span className="mt-1 w-1 shrink-0 self-stretch rounded-full bg-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm whitespace-pre-wrap text-slate-900">{item.text}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{when}</p>
        </div>
      </li>
    );
  if (item.kind === "message")
    return (
      <li className="flex gap-3 py-2.5">
        <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-[#009fd9]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">{item.from === "business" ? "You" : name}: </span>
            {item.text}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Thumbtack · {when}</p>
        </div>
      </li>
    );
  if (item.kind === "done")
    return (
      <li className="flex gap-3 py-2 text-sm text-slate-600">
        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <p className="flex-1">
          Did: {item.text} <span className="text-[11px] text-slate-400">{when}</span>
        </p>
      </li>
    );
  if (item.kind === "stage")
    return (
      <li className="flex gap-3 py-2 text-sm text-slate-500">
        <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
        <p className="flex-1">
          Moved to {STAGE_LABELS[item.to]} <span className="text-[11px] text-slate-400">{when}</span>
        </p>
      </li>
    );
  return (
    <li className="flex gap-3 py-2 text-sm text-slate-500">
      <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-300" />
      <p className="flex-1">
        {item.text} <span className="text-[11px] text-slate-400">{when}</span>
      </p>
    </li>
  );
}
