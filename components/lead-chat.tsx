"use client";

import type { FunctionReturnType } from "convex/server";
import { ExternalLink, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { conversationUrl, type LeadAttachment } from "@/lib/thumbtack";
import { cn } from "@/lib/utils";

// A **Lead**'s own pieces, laid open under the customer page's Thumbtack
// section: what they asked, the **Thumbtack chat**, and the one way to answer.
// The **Pipeline**'s Quick panel carries no chat; its **Deal** links out.

/** One message of a Thumbtack chat, as `leads.forCustomer` returns it. */
export type LeadMessage = FunctionReturnType<typeof api.leads.forCustomer>[number]["messages"][number];

// Thumbtack times read in the business's own zone, so the server's render and
// the browser's agree.
const whenFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const formatWhen = (at: number) => whenFormat.format(new Date(at));

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "Customer";

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
