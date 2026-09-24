"use client";

// PROTOTYPE. The inside of one deal: facts, stage, next step, the timeline
// (comments, stage moves, Thumbtack messages, proposal events, oldest first)
// and the comment box. Variants A and B show it in the side panel; variant C
// shows it inline as the right-hand pane.

import { useQuery } from "convex/react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSignature,
  MapPin,
  MessageSquare,
  Pencil,
  UserRound,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { SourceBadge, StageChip, whenFormat } from "@/components/pipeline-prototype/bits";
import { useDeals } from "@/components/pipeline-prototype/store";
import { FieldHeading } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  isOpen,
  money,
  type Activity,
  type Deal,
  type Stage,
} from "@/lib/pipeline-prototype";
import { conversationUrl, timeAgo } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

export function DealDetail({
  deal,
  /** Show the customer/title header. The side panel already has one. */
  header = false,
  /** Show the stage picker. The workbench has its own stepper on top. */
  stagePicker = true,
}: {
  deal: Deal;
  header?: boolean;
  stagePicker?: boolean;
}) {
  const { now, setStage, addComment, setNextStep } = useDeals();
  const timeline = useTimeline(deal);

  return (
    <div className="space-y-6">
      {header ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">{deal.customerName}</h2>
            <StageChip stage={deal.stage} />
            <SourceBadge source={deal.source} />
          </div>
          <p className="text-slate-600">{deal.title}</p>
        </div>
      ) : null}

      <div className="grid gap-x-6 gap-y-2 text-sm text-slate-700 sm:grid-cols-2">
        {deal.site ? (
          <Fact icon={MapPin}>{deal.site}</Fact>
        ) : (
          <Fact icon={MapPin}>
            <span className="text-slate-400">No site yet</span>
          </Fact>
        )}
        <Fact icon={Clock}>
          Started {timeAgo(deal.createdAt, now)} · in {STAGE_LABELS[deal.stage]} {timeAgo(deal.stageChangedAt, now)}
        </Fact>
        {deal.valueCents ? (
          <Fact icon={FileSignature}>
            {deal.proposal ? (
              <>
                {deal.proposal.code} · {money(deal.valueCents)} ·{" "}
                <span className="capitalize">{deal.proposal.state}</span>
              </>
            ) : (
              <>Ballpark {money(deal.valueCents)}</>
            )}
          </Fact>
        ) : null}
        {deal.customerId ? (
          <Fact icon={UserRound}>
            <Link href={`/customers/${deal.customerId}`} className="font-medium hover:underline">
              Open customer
            </Link>
          </Fact>
        ) : null}
      </div>

      {stagePicker ? (
        <StagePicker stage={deal.stage} onPick={(stage) => setStage(deal.id, stage)} />
      ) : null}

      <NextStep value={deal.nextStep ?? ""} onSave={(text) => setNextStep(deal.id, text)} />

      {deal.lead?.description ? (
        <div className="space-y-2">
          <FieldHeading>What they asked</FieldHeading>
          <p className="rounded-xl border bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-900">
            {deal.lead.description}
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <FieldHeading>Activity</FieldHeading>
          {deal.lead ? (
            <a
              href={conversationUrl(deal.lead.negotiationId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#007fae] hover:underline"
            >
              <ExternalLink aria-hidden className="size-3" /> Reply on Thumbtack
            </a>
          ) : null}
        </div>
        <Timeline items={timeline} customerName={deal.customerName} />
        <CommentBox onSubmit={(text) => addComment(deal.id, text)} />
      </div>

      {!isOpen(deal.stage) && deal.proposal?.state === "approved" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Won. Invoicing continues from the proposal.
        </p>
      ) : null}
    </div>
  );
}

// Real Thumbtack leads carry only their last message on the board; the full
// chat is fetched here and merged into the timeline. Seeded deals already hold
// theirs.
function useTimeline(deal: Deal): Activity[] {
  const leadId = deal.lead?.leadId as Id<"leads"> | undefined;
  const thread = useQuery(api.leads.thread, leadId ? { leadId } : "skip");
  if (!thread) return deal.activity;
  const messages: Activity[] = thread.map((m) => ({
    kind: "message",
    at: m.sentAt,
    from: m.from,
    text: m.text || "Sent an attachment",
  }));
  return [...deal.activity.filter((a) => a.kind !== "message"), ...messages].sort((a, b) => a.at - b.at);
}

function Fact({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function StagePicker({ stage, onPick }: { stage: Stage; onPick: (stage: Stage) => void }) {
  const closed = !isOpen(stage);
  return (
    <div className="space-y-2">
      <FieldHeading>Stage</FieldHeading>
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
          <Segmented<Stage>
            label="Stage"
            value={stage}
            onChange={onPick}
            options={OPEN_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
          />
        </div>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          aria-pressed={stage === "won"}
          onClick={() => onPick("won")}
          className={cn(stage === "won" && "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90 hover:text-white")}
        >
          <CheckCircle2 data-icon="inline-start" aria-hidden /> Won
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={stage === "lost"}
          onClick={() => onPick("lost")}
          className={cn(stage === "lost" && "border-slate-600 bg-slate-600 text-white hover:bg-slate-600/90 hover:text-white")}
        >
          <XCircle data-icon="inline-start" aria-hidden /> Lost
        </Button>
      </div>
      {closed ? <p className="text-xs text-slate-500">{STAGE_LABELS[stage]}. Pick a stage to reopen it.</p> : null}
    </div>
  );
}

// One line the owner keeps for themself: what happens next on this deal.
function NextStep({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing)
    return (
      <div className="space-y-2">
        <FieldHeading>Next step</FieldHeading>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="group flex w-full items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-left text-sm hover:border-slate-400 hover:bg-slate-50"
        >
          <ArrowRight aria-hidden className="size-4 shrink-0 text-slate-400" />
          <span className={cn("flex-1", value ? "text-slate-900" : "text-slate-400")}>
            {value || "What's next? Click to write it."}
          </span>
          <Pencil aria-hidden className="size-3.5 text-slate-300 group-hover:text-slate-500" />
        </button>
      </div>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft.trim());
        setEditing(false);
      }}
    >
      <FieldHeading>Next step</FieldHeading>
      <div className="flex gap-2">
        <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Call back Thursday" className="h-9" />
        <Button type="submit" size="sm" className="h-9">
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Timeline({ items, customerName }: { items: Activity[]; customerName: string }) {
  const first = customerName.trim().split(/\s+/)[0] || "Customer";
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-5">
      {items.map((item, i) => (
        <li key={`${item.kind}-${item.at}-${i}`} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-white",
              item.kind === "comment" && "bg-amber-400",
              item.kind === "message" && "bg-[#009fd9]",
              item.kind === "stage" && "bg-slate-300",
              item.kind === "proposal" && "bg-violet-400",
              item.kind === "created" && "bg-slate-900",
            )}
          />
          {item.kind === "comment" ? (
            <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-slate-900">
              <p className="whitespace-pre-wrap">{item.text}</p>
              <p className="mt-1 text-[11px] text-amber-800/70">You · {whenFormat.format(new Date(item.at))}</p>
            </div>
          ) : item.kind === "message" ? (
            <div
              className={cn(
                "max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm",
                item.from === "business" ? "ml-auto bg-slate-900 text-white" : "bg-slate-100 text-slate-900",
              )}
            >
              <p className="whitespace-pre-wrap">{item.text}</p>
              <p className={cn("mt-1 text-[11px]", item.from === "business" ? "text-white/60" : "text-slate-500")}>
                <MessageSquare aria-hidden className="mr-1 inline size-3" />
                {item.from === "business" ? "You on Thumbtack" : `${first} on Thumbtack`} · {whenFormat.format(new Date(item.at))}
              </p>
            </div>
          ) : item.kind === "stage" ? (
            <p className="py-0.5 text-xs text-slate-500">
              Moved <span className="font-medium text-slate-700">{STAGE_LABELS[item.from]}</span>
              <ArrowRight aria-hidden className="mx-1 inline size-3" />
              <span className="font-medium text-slate-700">{STAGE_LABELS[item.to]}</span> · {whenFormat.format(new Date(item.at))}
            </p>
          ) : (
            <p className="py-0.5 text-sm text-slate-700">
              {item.text}
              <span className="ml-1.5 text-xs text-slate-500">{whenFormat.format(new Date(item.at))}</span>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function CommentBox({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  };
  return (
    <form onSubmit={send} className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder="Leave a note for yourself: what they said, what you measured, what to bring."
        className="min-h-20 bg-white"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Notes are yours only. Ctrl+Enter to save.</p>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Add note
        </Button>
      </div>
    </form>
  );
}
