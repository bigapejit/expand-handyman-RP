"use client";

import { Inbox, Trophy, XCircle } from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";

import { IndexEmptyState } from "@/components/index-row";
import { StageChip, type BoardLead } from "@/components/lead-panel";
import { Segmented } from "@/components/ui/segmented";
import type { Id } from "@/convex/_generated/dataModel";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  duration,
  placeOf,
  timeAgo,
  waitingOnThem,
  type Stage,
} from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

const Arriving = "Leads arrive here from Thumbtack once the webhook is on.";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});

// The clock "time ago" reads from, moved on each minute so a card's age keeps
// up while the board sits open.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

// The card being dragged, as the drop targets read it. Kept in state rather
// than only on the drag's data, because `dragover` cannot read the data and
// the columns need to know which stage the card is leaving.
type Dragging = { leadId: Id<"leads">; stage: Stage } | null;

// The **Thumbtack board**: open leads in a column per stage, and the Won and
// Lost ones behind Closed as a flat list. `leads` comes newest first. A card
// is dragged between columns, or onto Won or Lost, which appear only while a
// card is in the air; on a phone, where there is no drag, the panel's stage
// control does the same.
export function ThumbtackBoard({
  leads,
  onOpen,
  onSetStage,
}: {
  leads: BoardLead[];
  onOpen: (leadId: Id<"leads">) => void;
  onSetStage: (leadId: Id<"leads">, stage: Stage) => void;
}) {
  const [view, setView] = useState<"open" | "closed">("open");
  const [dragging, setDragging] = useState<Dragging>(null);
  const now = useNow();
  const closed = leads.filter((lead) => !OPEN_STAGES.includes(lead.stage));
  const openCount = leads.length - closed.length;

  const drop = (stage: Stage) => (event: DragEvent) => {
    event.preventDefault();
    const leadId = (event.dataTransfer.getData("text/plain") ||
      dragging?.leadId) as Id<"leads"> | "";
    setDragging(null);
    if (leadId && dragging?.stage !== stage) onSetStage(leadId, stage);
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
      <Segmented
        label="Show"
        value={view}
        onChange={setView}
        options={[
          { value: "open", label: `Open · ${openCount}` },
          { value: "closed", label: `Closed · ${closed.length}` },
        ]}
      />

      {view === "open" ? (
        leads.length === 0 ? (
          <IndexEmptyState icon={Inbox} title="No leads yet">
            {Arriving}
          </IndexEmptyState>
        ) : (
          <>
            {/* A phone scrolls the columns sideways; a wide screen shows all five. */}
            <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
              {OPEN_STAGES.map((stage) => {
                const inColumn = leads.filter((lead) => lead.stage === stage);
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
                    </header>
                    {inColumn.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                        {receiving ? `Drop to move to ${STAGE_LABELS[stage]}` : "Nothing here"}
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {inColumn.map((lead) => (
                          <li key={lead._id}>
                            <LeadCard
                              lead={lead}
                              now={now}
                              lifted={dragging?.leadId === lead._id}
                              onOpen={() => onOpen(lead._id)}
                              onLift={() => setDragging({ leadId: lead._id, stage: lead.stage })}
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
              <DropZone
                label="Won"
                icon={Trophy}
                tone="green"
                onDragOver={allow("won")}
                onDrop={drop("won")}
              />
              <DropZone
                label="Lost"
                icon={XCircle}
                tone="slate"
                onDragOver={allow("lost")}
                onDrop={drop("lost")}
              />
            </div>
          </>
        )
      ) : closed.length === 0 ? (
        <IndexEmptyState icon={Inbox} title="Nothing closed yet">
          {Arriving}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {closed.map((lead) => (
            <li key={lead._id}>
              <button
                type="button"
                onClick={() => onOpen(lead._id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{lead.customerName}</p>
                  <p className="truncate text-sm text-slate-500">{whatAndWhere(lead)}</p>
                </div>
                <span className="hidden text-sm text-slate-500 sm:inline">
                  Arrived {dayFormat.format(new Date(lead.arrivedAt))}
                </span>
                <StageChip stage={lead.stage} />
              </button>
            </li>
          ))}
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

function whatAndWhere(lead: BoardLead) {
  return [lead.category, placeOf(lead.location)].filter(Boolean).join(" · ");
}

function LeadCard({
  lead,
  now,
  lifted,
  onOpen,
  onLift,
  onSettle,
}: {
  lead: BoardLead;
  now: number;
  lifted: boolean;
  onOpen: () => void;
  onLift: () => void;
  onSettle: () => void;
}) {
  const { unread } = lead;
  return (
    <button
      type="button"
      draggable
      onClick={onOpen}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", lead._id);
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
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-slate-900",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          {lead.customerName}
        </span>
        {unread ? <UnreadDot /> : null}
        {/* The server's clock and the browser's may straddle a minute. */}
        <span suppressHydrationWarning className="shrink-0 text-xs text-slate-500 tabular-nums">
          {timeAgo(lead.arrivedAt, now)}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-slate-500">{whatAndWhere(lead)}</span>
      <span
        className={cn("mt-2 line-clamp-2 text-sm", unread ? "text-slate-900" : "text-slate-600")}
      >
        <Snippet lead={lead} />
      </span>
      <StageNote lead={lead} now={now} />
    </button>
  );
}

// What the column alone does not say: in New, that the owner wrote last and
// the customer has not answered; in Booked and Estimating, how long the lead
// has sat there.
function StageNote({ lead, now }: { lead: BoardLead; now: number }) {
  if (lead.stage === "new" && waitingOnThem(lead) && lead.lastMessage)
    return (
      <span
        suppressHydrationWarning
        className="mt-2 inline-block max-w-full rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800"
      >
        {/* A narrow column breaks the line at the dot, not inside either half. */}
        <span className="whitespace-nowrap">Waiting on them ·</span>{" "}
        <span className="whitespace-nowrap">{timeAgo(lead.lastMessage.sentAt, now)}</span>
      </span>
    );
  if (lead.stage === "booked" || lead.stage === "estimating")
    return (
      <span suppressHydrationWarning className="mt-2 block text-xs text-slate-500">
        In {STAGE_LABELS[lead.stage]} for {duration(now - lead.stageChangedAt)}
      </span>
    );
  return null;
}

function UnreadDot() {
  return (
    <span
      role="img"
      aria-label="Unread"
      className="size-2 shrink-0 rounded-full bg-sky-500 ring-2 ring-sky-100"
    />
  );
}

// The last word in the chat, or what they asked while nobody has written.
function Snippet({ lead }: { lead: BoardLead }) {
  const last = lead.lastMessage;
  if (!last) return <>{lead.description}</>;
  return (
    <>
      {last.from === "business" ? <span className="text-slate-400">You: </span> : null}
      {last.text || "Sent an attachment"}
    </>
  );
}
