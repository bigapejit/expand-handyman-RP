"use client";

// PROTOTYPE, delete before merge. Two looks for the Thumbtack board, flipped
// with `?variant=A|B`: A is kanban columns, B is the Proposals-style list.
// Everything lives in React memory; nothing is saved.

import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Inbox,
  MapPin,
  Phone,
  Search,
  Tag,
  UserRound,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { FieldHeading, SidePanel, useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { panelHref } from "@/lib/side-panel";
import {
  PROTOTYPE_NOW,
  prototypeLeads,
  type LeadStage,
  type MessageCreatedV4,
  type PrototypeLead,
  type ThumbtackAttachment,
} from "@/lib/prototype-thumbtack-fixtures";
import { cn } from "@/lib/utils";

const LeadParam = "lead";

type OpenStage = "new" | "talking" | "quoted";

const stageLabels: Record<LeadStage, string> = {
  new: "New",
  talking: "Talking",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

const openStages: OpenStage[] = ["new", "talking", "quoted"];

const variants = [
  { value: "A", label: "A · Board" },
  { value: "B", label: "B · List" },
];

// ---------------------------------------------------------------- helpers

const idOf = (lead: PrototypeLead) => lead.negotiation.negotiationID;

const nameOf = (lead: PrototypeLead) =>
  `${lead.negotiation.customer.firstName} ${lead.negotiation.customer.lastName}`;

const placeOf = (lead: PrototypeLead) =>
  `${lead.negotiation.request.location.city}, ${lead.negotiation.request.location.state}`;

function isOpen(stage: LeadStage): stage is OpenStage {
  return stage === "new" || stage === "talking" || stage === "quoted";
}

function hasUnread(lead: PrototypeLead): boolean {
  return lead.messages.some(
    (message) =>
      message.from === "Customer" &&
      (lead.lastOpenedAt === null || message.sentAt > lead.lastOpenedAt),
  );
}

function newestFirst(a: PrototypeLead, b: PrototypeLead) {
  return b.negotiation.createdAt.localeCompare(a.negotiation.createdAt);
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function timeAgo(iso: string): string {
  const minutes = Math.max(
    1,
    Math.round((Date.parse(PROTOTYPE_NOW) - Date.parse(iso)) / 60000),
  );
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const whenFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});

const dollars = (price: string) => price.replace(/\.00$/, "");

function estimateLine(lead: PrototypeLead): string {
  const { type, total } = lead.negotiation.estimate;
  if (type === "Fixed" && total) return `Estimate: ${dollars(total)} fixed`;
  if (type === "Hourly" && total) return `Estimate: ${dollars(total)}/hr`;
  if (type === "OnSite") return "Estimate: after a site visit";
  return "Estimate: needs more info";
}

function lastMessage(lead: PrototypeLead): MessageCreatedV4 | undefined {
  return lead.messages[lead.messages.length - 1];
}

// ---------------------------------------------------------------- the board

export function PrototypeThumbtackBoard() {
  const searchParams = useSearchParams();
  const variant = searchParams.get("variant") === "B" ? "B" : "A";
  const [leads, setLeads] = useState<PrototypeLead[]>(() =>
    [...prototypeLeads].sort(newestFirst),
  );
  const { openId, open, close } = useSidePanel(LeadParam);
  const openLead = leads.find((lead) => idOf(lead) === openId);

  // Opening a lead is reading it: the unread dot goes.
  useEffect(() => {
    if (!openId) return;
    setLeads((current) =>
      current.map((lead) =>
        idOf(lead) === openId && hasUnread(lead)
          ? { ...lead, lastOpenedAt: PROTOTYPE_NOW }
          : lead,
      ),
    );
  }, [openId]);

  const setStage = (id: string, stage: LeadStage) =>
    setLeads((current) =>
      current.map((lead) => (idOf(lead) === id ? { ...lead, stage } : lead)),
    );

  return (
    // Room at the bottom so the floating switcher never covers the last row.
    <div className="pb-16">
      {variant === "A" ? (
        <BoardVariant leads={leads} onOpen={open} />
      ) : (
        <ListVariant leads={leads} />
      )}
      {openLead ? (
        <LeadPanel
          key={idOf(openLead)}
          lead={openLead}
          onStage={(stage) => setStage(idOf(openLead), stage)}
          onClose={close}
        />
      ) : null}
      <PrototypeSwitcher variants={variants} current={variant} />
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

function UnreadDot() {
  return (
    <span
      role="img"
      aria-label="Unread"
      className="size-2 shrink-0 rounded-full bg-sky-500 ring-2 ring-sky-100"
    />
  );
}

function StageChip({ stage }: { stage: LeadStage }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
        stage === "new" && "border-sky-300 bg-sky-50 text-sky-900",
        stage === "talking" && "border-amber-300 bg-amber-50 text-amber-900",
        stage === "quoted" && "border-violet-300 bg-violet-50 text-violet-900",
        stage === "won" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        stage === "lost" && "border-slate-300 bg-slate-100 text-slate-600",
      )}
    >
      {stageLabels[stage]}
    </span>
  );
}

function Snippet({ lead }: { lead: PrototypeLead }) {
  const last = lastMessage(lead);
  if (!last) return <>{lead.negotiation.request.description}</>;
  const text =
    last.text || (last.attachments.length ? `Sent ${last.attachments[0].fileName}` : "");
  return (
    <>
      {last.from === "Business" ? <span className="text-slate-400">You: </span> : null}
      {text}
    </>
  );
}

// ---------------------------------------------------------------- variant A

function BoardVariant({
  leads,
  onOpen,
}: {
  leads: PrototypeLead[];
  onOpen: (id: string) => void;
}) {
  const [view, setView] = useState<"open" | "closed">("open");
  const closed = leads.filter((lead) => !isOpen(lead.stage));
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
        // A phone scrolls the columns sideways; a wide screen shows all three.
        <div className="no-scrollbar -mx-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-8 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
          {openStages.map((stage) => {
            const inColumn = leads.filter((lead) => lead.stage === stage);
            return (
              <section
                key={stage}
                aria-label={stageLabels[stage]}
                className="w-[82%] max-w-sm shrink-0 snap-start rounded-2xl bg-slate-100/80 p-2 lg:w-auto lg:max-w-none"
              >
                <header className="flex items-center gap-2 px-2 pt-1 pb-2">
                  <h2 className="text-sm font-semibold text-slate-900">{stageLabels[stage]}</h2>
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
                      <li key={idOf(lead)}>
                        <LeadCard lead={lead} onOpen={() => onOpen(idOf(lead))} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : closed.length === 0 ? (
        <IndexEmptyState icon={Inbox} title="Nothing closed yet">
          Mark a lead Won or Lost from its panel.
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {closed.map((lead) => (
            <li key={idOf(lead)}>
              <button
                type="button"
                onClick={() => onOpen(idOf(lead))}
                className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{nameOf(lead)}</p>
                  <p className="truncate text-sm text-slate-500">
                    {lead.negotiation.request.category.name} · {placeOf(lead)}
                  </p>
                </div>
                <span className="hidden text-sm text-slate-500 sm:inline">
                  Arrived {dayFormat.format(new Date(lead.negotiation.createdAt))}
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

function LeadCard({ lead, onOpen }: { lead: PrototypeLead; onOpen: () => void }) {
  const unread = hasUnread(lead);
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
          {nameOf(lead)}
        </span>
        {unread ? <UnreadDot /> : null}
        <span className="shrink-0 text-xs text-slate-500 tabular-nums">
          {timeAgo(lead.negotiation.createdAt)}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-slate-500">
        {lead.negotiation.request.category.name} · {placeOf(lead)}
      </span>
      <span
        className={cn(
          "mt-2 line-clamp-2 text-sm",
          unread ? "text-slate-900" : "text-slate-600",
        )}
      >
        <Snippet lead={lead} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- variant B

type Filter = OpenStage | "closed" | "all";

const filters: { value: Filter; label: string }[] = [
  { value: "new", label: "New" },
  { value: "talking", label: "Talking" },
  { value: "quoted", label: "Quoted" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

function ListVariant({ leads }: { leads: PrototypeLead[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const query = search.trim().toLowerCase();
  const shown = leads.filter(
    (lead) =>
      (filter === "all" ||
        (filter === "closed" ? !isOpen(lead.stage) : lead.stage === filter)) &&
      `${nameOf(lead)} ${lead.negotiation.request.category.name} ${placeOf(lead)}`
        .toLowerCase()
        .includes(query),
  );

  return (
    <div className="space-y-4">
      <label className="relative block w-full max-w-md">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, job or city"
          aria-label="Search leads"
          className="h-9 pl-8"
        />
      </label>
      <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
        <Segmented label="Stage" value={filter} onChange={setFilter} options={filters} />
      </div>

      {shown.length === 0 ? (
        <IndexEmptyState
          icon={Inbox}
          title={query ? "No lead matches that" : "No leads here"}
        >
          {query ? "Try a different search or stage." : "New Thumbtack leads land here."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((lead) => (
            <IndexRow
              key={idOf(lead)}
              href={panelHref(pathname, searchParams.toString(), LeadParam, idOf(lead))}
              title={nameOf(lead)}
              subtitle={`${lead.negotiation.request.category.name} · ${placeOf(lead)} · ${timeAgo(lead.negotiation.createdAt)}`}
              hint={
                <>
                  {hasUnread(lead) ? <UnreadDot /> : null}
                  <StageChip stage={lead.stage} />
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the panel

function LeadPanel({
  lead,
  onStage,
  onClose,
}: {
  lead: PrototypeLead;
  onStage: (stage: LeadStage) => void;
  onClose: () => void;
}) {
  const { negotiation } = lead;
  const { request, customer } = negotiation;
  const { location } = request;
  const place = `${location.city}, ${location.state} ${location.zipCode}`;

  return (
    <SidePanel
      title={nameOf(lead)}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{request.category.name}</span>
          <span aria-hidden>·</span>
          <StageChip stage={lead.stage} />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        {/* Who and where */}
        <div className="space-y-2 text-sm text-slate-700">
          <FactRow icon={Phone}>
            <a href={`tel:${customer.phone}`} className="font-medium text-slate-900 hover:underline">
              {formatPhone(customer.phone)}
            </a>
            <span className="text-slate-500"> · Thumbtack number</span>
          </FactRow>
          <FactRow icon={MapPin}>
            {location.address1 ? `${location.address1}, ${place}` : place}
          </FactRow>
          <FactRow icon={Clock}>
            Arrived {whenFormat.format(new Date(negotiation.createdAt))}
          </FactRow>
          <FactRow icon={Tag}>{estimateLine(lead)}</FactRow>
          <p className="pl-6 text-xs text-slate-500">Lead cost {negotiation.leadPrice}</p>
        </div>

        {/* Stage */}
        <div className="space-y-2">
          <FieldHeading>Stage</FieldHeading>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<OpenStage>
              label="Stage"
              // Won and Lost light neither segment; picking one reopens it.
              value={lead.stage as OpenStage}
              onChange={onStage}
              options={openStages.map((stage) => ({ value: stage, label: stageLabels[stage] }))}
            />
            <span className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              aria-pressed={lead.stage === "won"}
              onClick={() => onStage("won")}
              className={cn(
                lead.stage === "won" &&
                  "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90 hover:text-white",
              )}
            >
              <CheckCircle2 data-icon="inline-start" aria-hidden /> Won
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-pressed={lead.stage === "lost"}
              onClick={() => onStage("lost")}
              className={cn(
                lead.stage === "lost" &&
                  "border-slate-600 bg-slate-600 text-white hover:bg-slate-600/90 hover:text-white",
              )}
            >
              <XCircle data-icon="inline-start" aria-hidden /> Lost
            </Button>
          </div>
          {isOpen(lead.stage) ? null : (
            <p className="text-xs text-slate-500">
              {stageLabels[lead.stage]}. Pick a stage to reopen it.
            </p>
          )}
        </div>

        {/* What they asked */}
        <div className="space-y-2">
          <FieldHeading>What they asked</FieldHeading>
          <div className="space-y-4 rounded-xl border bg-slate-50 p-4">
            <p className="text-sm text-slate-900">{request.description}</p>
            {request.details.length ? (
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,13rem)_1fr]">
                {request.details.map((detail) => (
                  <div key={detail.question} className="contents">
                    <dt className="text-slate-500">{detail.question}</dt>
                    <dd className="mb-1.5 font-medium text-slate-900 sm:mb-0">{detail.answer}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {request.attachments.length ? (
              <Attachments attachments={request.attachments} />
            ) : null}
          </div>
        </div>

        {/* Chat */}
        <div className="space-y-3">
          <div className="space-y-1">
            <FieldHeading>Chat</FieldHeading>
            <p className="text-xs text-slate-500">Messages arrive from Thumbtack. Reply there.</p>
          </div>
          <ol className="space-y-3 rounded-xl border bg-white p-4">
            {lead.messages.map((message) => (
              <ChatBubble key={message.messageID} message={message} customerName={customer.firstName} />
            ))}
          </ol>
          <Button
            size="lg"
            nativeButton={false}
            render={
              <a
                href={`https://www.thumbtack.com/pro-inbox/messages/${negotiation.negotiationID}`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <ExternalLink data-icon="inline-start" aria-hidden /> Send message on Thumbtack
          </Button>
        </div>

        <div className="border-t pt-4">
          <Link
            href="/customers"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline"
          >
            <UserRound aria-hidden className="size-4" /> Open customer
          </Link>
        </div>
      </div>
    </SidePanel>
  );
}

function FactRow({
  icon: Icon,
  children,
}: {
  icon: typeof Phone;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function ChatBubble({
  message,
  customerName,
}: {
  message: MessageCreatedV4;
  customerName: string;
}) {
  const mine = message.from === "Business";
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
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
        {mine ? "Expand" : customerName} · {whenFormat.format(new Date(message.sentAt))}
      </p>
    </li>
  );
}

function Attachments({
  attachments,
  onDark = false,
}: {
  attachments: ThumbtackAttachment[];
  onDark?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((file) =>
        file.mimeType.startsWith("image/") ? (
          <a
            key={file.fileName}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- prototype */}
            <img src={file.url} alt={file.fileName} className="h-28 w-40 object-cover" />
          </a>
        ) : (
          <a
            key={file.fileName}
            href={file.url}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
              onDark
                ? "border-white/20 bg-white/10 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <FileText aria-hidden className="size-3.5" /> {file.fileName}
          </a>
        ),
      )}
    </div>
  );
}
