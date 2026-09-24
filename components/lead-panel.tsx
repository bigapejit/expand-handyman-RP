"use client";

import type { FunctionReturnType } from "convex/server";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  LoaderCircle,
  MapPin,
  Phone,
  Tag,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { FieldHeading, SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { displayPhone } from "@/lib/customer";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  addressLine,
  conversationUrl,
  estimateLine,
  type LeadAttachment,
  type Stage,
} from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

/** One card on the Thumbtack board, as `leads.board` returns it. */
export type BoardLead = FunctionReturnType<typeof api.leads.board>[number];

/** One message of a Thumbtack chat, as `leads.thread` returns it. */
export type LeadMessage = NonNullable<FunctionReturnType<typeof api.leads.thread>>[number];

/** The search parameter naming the open lead, as `?lead=<id>`. */
export const LeadPanelParam = "lead";

// Thumbtack times read in the business's own zone, so the server's render and
// the browser's agree.
const whenFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatWhen = (at: number) => whenFormat.format(new Date(at));

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "Customer";

// The panel the board opens over itself: who the lead is from, where it
// stands, what they asked, and the chat. Read-only but for the stage; the
// reply goes out on Thumbtack. `messages` is undefined while the chat loads.
export function LeadPanel({
  lead,
  messages,
  onSetStage,
  onClose,
}: {
  lead: BoardLead;
  messages: LeadMessage[] | undefined;
  onSetStage: (leadId: Id<"leads">, stage: Stage) => void;
  onClose: () => void;
}) {
  const address = addressLine(lead.location);
  const estimate = estimateLine(lead.estimate);

  return (
    <SidePanel
      title={lead.customerName}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{lead.category}</span>
          <span aria-hidden>·</span>
          <StageChip stage={lead.stage} />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        <div className="space-y-2 text-sm text-slate-700">
          {lead.phone ? (
            <FactRow icon={Phone}>
              <a href={`tel:${lead.phone}`} className="font-medium text-slate-900 hover:underline">
                {displayPhone(lead.phone)}
              </a>
              {lead.phoneFrom === "thumbtack" ? (
                <span className="text-slate-500"> · Thumbtack number</span>
              ) : null}
            </FactRow>
          ) : null}
          {address ? <FactRow icon={MapPin}>{address}</FactRow> : null}
          <FactRow icon={Clock}>Arrived {formatWhen(lead.arrivedAt)}</FactRow>
          {estimate ? <FactRow icon={Tag}>{estimate}</FactRow> : null}
          {lead.leadPrice ? (
            <p className="pl-6 text-xs text-slate-500">Lead cost {lead.leadPrice}</p>
          ) : null}
        </div>

        <StagePicker stage={lead.stage} onPick={(stage) => onSetStage(lead._id, stage)} />

        <div className="space-y-2">
          <FieldHeading>What they asked</FieldHeading>
          <LeadAsked lead={lead} />
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <FieldHeading>Chat</FieldHeading>
            <p className="text-xs text-slate-500">Messages arrive from Thumbtack. Reply there.</p>
          </div>
          {messages === undefined ? (
            <div className="grid min-h-24 place-items-center rounded-xl border bg-white">
              <LoaderCircle aria-label="Loading chat" className="size-5 animate-spin text-slate-500" />
            </div>
          ) : (
            <LeadChat messages={messages} customerName={lead.customerName} />
          )}
          <SendOnThumbtack negotiationId={lead.negotiationId} />
        </div>

        <div className="border-t pt-4">
          <Link
            href={`/customers/${lead.customerId}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline"
          >
            <UserRound aria-hidden className="size-4" /> Open customer
          </Link>
        </div>
      </div>
    </SidePanel>
  );
}

// The open stages on the Segmented; Won and Lost as their own buttons.
// A closed lead lights no segment, and picking one reopens it.
function StagePicker({ stage, onPick }: { stage: Stage; onPick: (stage: Stage) => void }) {
  const closed = !OPEN_STAGES.includes(stage);
  return (
    <div className="space-y-2">
      <FieldHeading>Stage</FieldHeading>
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
          <Segmented<Stage>
            label="Stage"
            value={stage}
            onChange={onPick}
            options={OPEN_STAGES.map((open) => ({ value: open, label: STAGE_LABELS[open] }))}
          />
        </div>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          aria-pressed={stage === "won"}
          onClick={() => onPick("won")}
          className={cn(
            stage === "won" &&
              "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90 hover:text-white",
          )}
        >
          <CheckCircle2 data-icon="inline-start" aria-hidden /> Won
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={stage === "lost"}
          onClick={() => onPick("lost")}
          className={cn(
            stage === "lost" &&
              "border-slate-600 bg-slate-600 text-white hover:bg-slate-600/90 hover:text-white",
          )}
        >
          <XCircle data-icon="inline-start" aria-hidden /> Lost
        </Button>
      </div>
      {closed ? (
        <p className="text-xs text-slate-500">
          {STAGE_LABELS[stage]}. Pick a stage to reopen it.
        </p>
      ) : null}
    </div>
  );
}

function FactRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function StageChip({ stage }: { stage: Stage }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
        stage === "new" && "border-sky-300 bg-sky-50 text-sky-900",
        stage === "talking" && "border-amber-300 bg-amber-50 text-amber-900",
        stage === "booked" && "border-teal-300 bg-teal-50 text-teal-900",
        stage === "estimating" && "border-orange-300 bg-orange-50 text-orange-900",
        stage === "quoted" && "border-violet-300 bg-violet-50 text-violet-900",
        stage === "won" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        stage === "lost" && "border-slate-300 bg-slate-100 text-slate-600",
      )}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

/** "What they asked": the request's words, its answers and its files. */
export function LeadAsked({
  lead,
}: {
  lead: Pick<Doc<"leads">, "description" | "details" | "attachments">;
}) {
  const empty = !lead.description && !lead.details.length && !lead.attachments.length;
  return (
    <div className="space-y-4 rounded-xl border bg-slate-50 p-4">
      {empty ? (
        <p className="text-sm text-slate-500">Thumbtack sent no details for this lead.</p>
      ) : null}
      {lead.description ? (
        <p className="text-sm whitespace-pre-wrap text-slate-900">{lead.description}</p>
      ) : null}
      {lead.details.length ? (
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,13rem)_1fr]">
          {lead.details.map((detail, index) => (
            <div key={`${index}-${detail.question}`} className="contents">
              <dt className="text-slate-500">{detail.question}</dt>
              <dd className="mb-1.5 font-medium text-slate-900 sm:mb-0">{detail.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {lead.attachments.length ? <Attachments attachments={lead.attachments} /> : null}
    </div>
  );
}

/** The read-only Thumbtack chat: the customer on the left, Expand on the right. */
export function LeadChat({
  messages,
  customerName,
}: {
  messages: Pick<LeadMessage, "_id" | "from" | "text" | "attachments" | "sentAt">[];
  customerName: string;
}) {
  if (messages.length === 0) {
    return (
      <p className="rounded-xl border bg-white px-4 py-6 text-center text-sm text-slate-500">
        No messages yet.
      </p>
    );
  }
  const name = firstName(customerName);
  return (
    <ol className="space-y-3 rounded-xl border bg-white p-4">
      {messages.map((message) => {
        const mine = message.from === "business";
        return (
          <li key={message._id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2 text-sm sm:max-w-[75%]",
                mine
                  ? "rounded-br-md bg-slate-900 text-white"
                  : "rounded-bl-md bg-slate-100 text-slate-900",
              )}
            >
              {message.text ? <p className="whitespace-pre-wrap">{message.text}</p> : null}
              {message.attachments.length ? (
                <Attachments attachments={message.attachments} onDark={mine} />
              ) : null}
            </div>
            <p className="mt-1 px-1 text-[11px] text-slate-500">
              {mine ? "Expand" : name} · {formatWhen(message.sentAt)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** The one way to answer a lead: its conversation in Thumbtack's pro inbox. */
export function SendOnThumbtack({ negotiationId }: { negotiationId: string }) {
  return (
    <Button
      size="lg"
      nativeButton={false}
      render={<a href={conversationUrl(negotiationId)} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLink data-icon="inline-start" aria-hidden /> Send message on Thumbtack
    </Button>
  );
}

function Attachments({
  attachments,
  onDark = false,
}: {
  attachments: LeadAttachment[];
  onDark?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((file, index) =>
        file.mimeType.startsWith("image/") ? (
          <a
            key={`${index}-${file.url}`}
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Thumbtack's own URL, any size */}
            <img
              src={file.url}
              alt={file.description || file.fileName}
              className="h-28 w-40 object-cover"
            />
          </a>
        ) : (
          <a
            key={`${index}-${file.url}`}
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
              onDark
                ? "border-white/20 bg-white/10 text-white hover:bg-white/15"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <FileText aria-hidden className="size-3.5" /> {file.fileName || "Attachment"}
          </a>
        ),
      )}
    </div>
  );
}
