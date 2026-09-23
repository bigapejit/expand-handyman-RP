"use client";

import { Inbox } from "lucide-react";
import { useEffect, useState } from "react";

import { IndexEmptyState } from "@/components/index-row";
import { StageChip, type BoardLead } from "@/components/lead-panel";
import { Segmented } from "@/components/ui/segmented";
import type { Id } from "@/convex/_generated/dataModel";
import { OPEN_STAGES, STAGE_LABELS, placeOf, timeAgo } from "@/lib/thumbtack";
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

// The **Thumbtack board**: open leads in a column per stage, and the Won and
// Lost ones behind Closed as a flat list. `leads` comes newest first.
export function ThumbtackBoard({
  leads,
  onOpen,
}: {
  leads: BoardLead[];
  onOpen: (leadId: Id<"leads">) => void;
}) {
  const [view, setView] = useState<"open" | "closed">("open");
  const now = useNow();
  const closed = leads.filter((lead) => !OPEN_STAGES.includes(lead.stage));
  const openCount = leads.length - closed.length;

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
          // A phone scrolls the columns sideways; a wide screen shows all three.
          <div className="no-scrollbar -mx-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-8 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
            {OPEN_STAGES.map((stage) => {
              const inColumn = leads.filter((lead) => lead.stage === stage);
              return (
                <section
                  key={stage}
                  aria-label={STAGE_LABELS[stage]}
                  className="w-[82%] max-w-sm shrink-0 snap-start rounded-2xl bg-slate-100/80 p-2 lg:w-auto lg:max-w-none"
                >
                  <header className="flex items-center gap-2 px-2 pt-1 pb-2">
                    <h2 className="text-sm font-semibold text-slate-900">{STAGE_LABELS[stage]}</h2>
                    <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500 tabular-nums">
                      {inColumn.length}
                    </span>
                  </header>
                  {inColumn.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                      Nothing here
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {inColumn.map((lead) => (
                        <li key={lead._id}>
                          <LeadCard lead={lead} now={now} onOpen={() => onOpen(lead._id)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
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

function whatAndWhere(lead: BoardLead) {
  return [lead.category, placeOf(lead.location)].filter(Boolean).join(" · ");
}

function LeadCard({
  lead,
  now,
  onOpen,
}: {
  lead: BoardLead;
  now: number;
  onOpen: () => void;
}) {
  const { unread } = lead;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition hover:border-slate-300 hover:shadow-sm"
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
    </button>
  );
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
