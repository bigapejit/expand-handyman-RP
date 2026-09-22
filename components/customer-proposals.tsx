"use client";

// PROTOTYPE (wayfinder ticket #21): FRSG's site-proposals.tsx across all of a
// customer's sites, each row tagged with its site (#14). Stub data only; no
// button writes anything. The panel is a trimmed copy of FRSG's ProposalPanel
// (Contacts, paper signature and payments removed: one recipient, #17).
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  GripVertical,
  MapPin,
  Plus,
  Send,
  Star,
  ThumbsDown,
  Undo2,
  RotateCw,
} from "lucide-react";
import { useState } from "react";

import { CopyLinkButton } from "@/components/copy-link";
import { ProposalStateChip } from "@/components/proposal-chips";
import { FieldHeading, FieldLabel, SidePanel, useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCustomer } from "@/components/use-customer";
import { useAppOrigin } from "@/hooks/use-app-origin";
import {
  TaxRate,
  formatCents,
  proposalId,
  proposalMoney,
  proposalStateLabel,
  shortDate,
  stubProposals,
  stubSites,
  stubSolutions,
  type StubCustomer,
  type StubProposal,
  type StubSite,
  type StubSolution,
} from "@/lib/prototype-hub";
import { cn } from "@/lib/utils";

export function CustomerProposals({ customerId }: { customerId: string }) {
  const customer = useCustomer(customerId);
  if (!customer) return null; // the hub shell draws loading and not-found
  return <ProposalsCard customer={customer} />;
}

function ProposalsCard({ customer }: { customer: StubCustomer }) {
  const { openId, open, close } = useSidePanel("proposal");
  const sites = stubSites(customer);
  const proposals = stubProposals(customer);
  const openProposal = proposals.find((p) => p.proposalId === openId) ?? null;

  return (
    <section
      aria-labelledby="customer-proposals"
      className="overflow-hidden rounded-2xl border bg-white shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
        <div className="min-w-0">
          <h2 id="customer-proposals" className="font-semibold text-slate-950">
            Proposals
          </h2>
          {proposals.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500">
              {proposals.length === 1 ? "1 proposal" : `${proposals.length} proposals`} across{" "}
              {sites.length === 1 ? "1 site" : `${sites.length} sites`}.
            </p>
          ) : null}
        </div>
        <NewForSite sites={sites} label="New proposal" />
      </header>

      {proposals.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">
          No proposals yet. Assemble one from a site&rsquo;s solutions; several are fine, as
          options for the same decision.
        </p>
      ) : (
        <ol>
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.proposalId}
              customer={customer}
              sites={sites}
              proposal={proposal}
              open={() => open(proposal.proposalId)}
            />
          ))}
        </ol>
      )}

      {openProposal ? (
        <ProposalPanel
          key={openProposal.proposalId}
          customer={customer}
          sites={sites}
          proposal={openProposal}
          onClose={close}
        />
      ) : null}
    </section>
  );
}

// "New proposal" / "New solution" ask which site first (#14, #15).
export function NewForSite({ sites, label }: { sites: StubSite[]; label: string }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="lg" />}>
        <Plus data-icon="inline-start" aria-hidden /> {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-1 p-1.5">
        <p className="px-2 pt-1 pb-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">
          Which site?
        </p>
        {sites.map((site) => (
          <button
            key={site.siteId}
            type="button"
            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
          >
            <span className="text-sm font-medium text-slate-900">{site.name}</span>
            <span className="text-xs text-slate-500">{site.address}</span>
          </button>
        ))}
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md border-t px-2 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
        >
          <Plus aria-hidden className="size-3.5" /> Add a site
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function SiteTag({ site }: { site: StubSite | undefined }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-slate-500">
      <MapPin aria-hidden className="size-3" />
      {site?.name ?? "Unknown site"}
    </span>
  );
}

function ProposalRow({
  customer,
  sites,
  proposal,
  open,
}: {
  customer: StubCustomer;
  sites: StubSite[];
  proposal: StubProposal;
  open: () => void;
}) {
  const money = proposalMoney(customer, proposal);
  const site = sites.find((s) => s.siteId === proposal.siteId);
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium text-slate-900">{proposal.title}</span>
            <ProposalStateChip state={proposal.state} />
            {proposal.recommended ? <RecommendedMark /> : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
            <SiteTag site={site} />
            <span aria-hidden>·</span>
            <span className="truncate">
              {proposal.solutionIds.length === 1
                ? "1 solution"
                : `${proposal.solutionIds.length} solutions`}{" "}
              · {standingLine(proposal)}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-slate-900">
          {formatCents(money.totalCents)}
        </span>
      </button>
    </li>
  );
}

function standingLine(proposal: StubProposal): string {
  if (proposal.state === "approved" && proposal.decidedAt)
    return `Approved ${shortDate(proposal.decidedAt)}`;
  if (proposal.state === "declined" && proposal.decidedAt)
    return `Declined ${shortDate(proposal.decidedAt)}`;
  if (proposal.sentAt) {
    const opened = proposal.openedAt ? `opened ${shortDate(proposal.openedAt)}` : "not opened";
    return `Sent ${shortDate(proposal.sentAt)} · ${opened}`;
  }
  return "Edited today";
}

function RecommendedMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
      <Star aria-hidden className="size-3" /> Recommended
    </span>
  );
}

function ProposalPanel({
  customer,
  sites,
  proposal,
  onClose,
}: {
  customer: StubCustomer;
  sites: StubSite[];
  proposal: StubProposal;
  onClose: () => void;
}) {
  const origin = useAppOrigin();
  const money = proposalMoney(customer, proposal);
  const site = sites.find((s) => s.siteId === proposal.siteId);
  const siteSolutions = stubSolutions(customer).filter((s) => s.siteId === proposal.siteId);
  const [picked, setPicked] = useState(proposal.solutionIds);
  const offered = picked
    .map((id) => siteSolutions.find((s) => s.solutionId === id))
    .filter((s): s is StubSolution => Boolean(s));
  const available = siteSolutions.filter((s) => !picked.includes(s.solutionId));
  const isDraft = proposal.state === "draft";
  const link = `${origin}/sign/prototype-${proposal.proposalId.slice(-6)}`;

  return (
    <SidePanel
      title={proposal.title}
      description={`${proposalId(sites, proposal)} · ${site?.address ?? ""} · ${proposalStateLabel(proposal.state)} · ${formatCents(money.totalCents)}`}
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        {isDraft ? (
          <div className="flex items-center gap-2">
            <Button variant="outline">
              <Eye data-icon="inline-start" aria-hidden /> Preview
            </Button>
          </div>
        ) : null}

        {proposal.sentAt ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 flex-1 text-sm text-slate-500">
              Sent {shortDate(proposal.sentAt)} to {customer.email || "the customer"}
            </p>
            {proposal.state !== "declined" ? (
              <Button variant="outline" size="sm">
                <Download data-icon="inline-start" aria-hidden />
                {proposal.state === "approved" ? "Download signed copy" : "Download PDF"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {proposal.state === "approved" && proposal.decidedAt ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Approved by {customer.name} on {shortDate(proposal.decidedAt)}, signed electronically.
          </div>
        ) : null}
        {proposal.state === "declined" && proposal.decidedAt ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
            Declined by {customer.name} on {shortDate(proposal.decidedAt)}.
          </p>
        ) : null}

        {isDraft ? (
          <>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="proposal-name">Name</FieldLabel>
              <Input
                id="proposal-name"
                defaultValue={proposal.title}
                className="w-full bg-white font-medium"
              />
              <p className="text-xs text-slate-500">
                Leave this empty and the proposal is called after the solutions it offers.
              </p>
            </div>

            <div className="space-y-2">
              <FieldHeading>Solutions in this proposal</FieldHeading>
              {offered.length === 0 ? (
                <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-slate-500">
                  Nothing yet. Tick the solutions this proposal offers.
                </p>
              ) : (
                <ol className="divide-y overflow-hidden rounded-xl border">
                  {offered.map((solution, index) => (
                    <li
                      key={solution.solutionId}
                      className="flex items-center gap-2 bg-white px-3 py-2 text-sm"
                    >
                      <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-slate-300" />
                      <input
                        type="checkbox"
                        checked
                        aria-label={`Remove ${solution.title}`}
                        onChange={() => setPicked(picked.filter((id) => id !== solution.solutionId))}
                        className="size-4 shrink-0 accent-slate-900"
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-900">{solution.title}</span>
                      <PriceLabel cents={solution.priceCents} />
                      <span className="flex shrink-0">
                        <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0}>
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Move down"
                          disabled={index === offered.length - 1}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {available.length > 0 ? (
                <>
                  <FieldHeading>Also written for {site?.name ?? "this site"}</FieldHeading>
                  <ul className="divide-y overflow-hidden rounded-xl border">
                    {available.map((solution) => (
                      <li
                        key={solution.solutionId}
                        className="flex items-center gap-2 bg-white px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={false}
                          aria-label={`Add ${solution.title}`}
                          onChange={() => setPicked([...picked, solution.solutionId])}
                          className="ml-6 size-4 shrink-0 accent-slate-900"
                        />
                        <span className="min-w-0 flex-1 truncate text-slate-700">{solution.title}</span>
                        <PriceLabel cents={solution.priceCents} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="proposal-notes">Notes and exclusions</FieldLabel>
              <textarea
                id="proposal-notes"
                defaultValue={proposal.notes}
                placeholder="Anything the scopes of work do not already say…"
                className="min-h-24 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <p className="text-xs text-slate-500">
                What is included beyond the scopes of work, what is excluded, scheduling and
                access. Leave it empty and the proposal prints nothing here.
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <FieldHeading>Solutions as offered</FieldHeading>
            <ol className="divide-y overflow-hidden rounded-xl border">
              {offered.map((solution) => (
                <li key={solution.solutionId} className="flex items-center gap-2 bg-white px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-900">{solution.title}</span>
                  <PriceLabel cents={solution.priceCents} />
                </li>
              ))}
            </ol>
            {proposal.notes ? (
              <>
                <FieldHeading>Notes and exclusions as offered</FieldHeading>
                <p className="rounded-xl border bg-slate-50/70 px-3 py-2 text-xs whitespace-pre-line text-slate-600">
                  {proposal.notes}
                </p>
              </>
            ) : null}
          </div>
        )}

        <div className="space-y-2">
          <FieldHeading>Money</FieldHeading>
          <dl className="space-y-1 rounded-xl border px-3 py-3 text-sm">
            <div className="flex justify-between gap-6 text-slate-500">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatCents(money.subtotalCents)}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 text-slate-500">
              <dt className="min-w-0">
                <span>Sales Tax</span>
                <span className="block text-xs text-slate-400">
                  Vancouver, Clark County · from the WA Department of Revenue
                </span>
              </dt>
              <dd className="flex shrink-0 items-center gap-2">
                {isDraft ? (
                  <Input
                    aria-label="Sales tax rate, percent"
                    defaultValue={String(TaxRate)}
                    className="w-20 bg-white text-right"
                  />
                ) : (
                  <span className="w-20 text-right tabular-nums text-slate-500">{TaxRate}</span>
                )}
                <span className="text-xs text-slate-400">%</span>
                <span className="w-24 text-right tabular-nums text-slate-900">
                  {formatCents(money.taxCents)}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-6 border-t pt-1 font-semibold text-slate-900">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatCents(money.totalCents)}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-2">
          <FieldHeading>Payment Terms</FieldHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <PercentBox
              label="Deposit, on signing"
              percent={proposal.depositPercent}
              cents={Math.round((money.totalCents * proposal.depositPercent) / 100)}
              editable={isDraft}
            />
            <PercentBox
              label="Final, on completion"
              percent={100 - proposal.depositPercent}
              cents={money.totalCents - Math.round((money.totalCents * proposal.depositPercent) / 100)}
              editable={isDraft}
            />
          </div>
          <p className="text-xs text-slate-500">
            {proposal.depositPercent}% on signing, the rest on completion.
          </p>
        </div>

        <div className="space-y-2">
          <FieldHeading>Recommended</FieldHeading>
          <Button variant={proposal.recommended ? "default" : "outline"} aria-pressed={proposal.recommended}>
            <Star data-icon="inline-start" aria-hidden />
            {proposal.recommended ? "Recommended" : "Mark as Recommended"}
          </Button>
          <p className="text-xs text-slate-500">
            At most one proposal per site carries the mark. The customer sees it on the paper.
          </p>
        </div>

        {proposal.sentAt ? (
          <div className="space-y-2">
            <FieldHeading>Signing link</FieldHeading>
            <ul className="divide-y overflow-hidden rounded-xl border">
              <li className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-900">{customer.email || "No email"}</span>
                  <span className="block truncate text-xs text-slate-500">
                    Sent {shortDate(proposal.sentAt)} ·{" "}
                    {proposal.openedAt ? `opened ${shortDate(proposal.openedAt)}` : "not opened yet"}
                  </span>
                </span>
                <span className="flex w-full items-center gap-2">
                  <CopyLinkButton url={link} />
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500 select-all">
                    {link}
                  </code>
                </span>
              </li>
            </ul>
          </div>
        ) : null}

        {isDraft ? (
          <div className="space-y-2 border-t pt-4">
            <Button size="lg" disabled={offered.some((s) => s.priceCents === null) || offered.length === 0}>
              <Send data-icon="inline-start" aria-hidden /> Send
            </Button>
            <p className="text-xs text-slate-500">
              {offered.some((s) => s.priceCents === null)
                ? "A solution in this proposal has no price yet."
                : `${customer.name} gets a private link to approve or decline this proposal, emailed to ${customer.email || "their email"}.`}
            </p>
          </div>
        ) : proposal.state === "sent" ? (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline">
              <Undo2 data-icon="inline-start" aria-hidden /> Withdraw
            </Button>
            <Button variant="outline">
              <RotateCw data-icon="inline-start" aria-hidden /> Re-send
            </Button>
            <Button variant="outline">
              <ThumbsDown data-icon="inline-start" aria-hidden /> Decline
            </Button>
          </div>
        ) : null}
      </div>
    </SidePanel>
  );
}

function PriceLabel({ cents }: { cents: number | null }) {
  return (
    <span
      className={cn(
        "shrink-0 tabular-nums",
        cents === null ? "text-amber-700" : "font-medium text-slate-900",
      )}
    >
      {cents === null ? "No price yet" : formatCents(cents)}
    </span>
  );
}

function PercentBox({
  label,
  percent,
  cents,
  editable,
}: {
  label: string;
  percent: number;
  cents: number;
  editable: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="block text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <div className="flex items-center gap-2">
        {editable ? (
          <Input defaultValue={String(percent)} className="w-20 bg-white text-right" aria-label={label} />
        ) : (
          <span className="w-20 text-right tabular-nums text-slate-500">{percent}</span>
        )}
        <span className="text-xs text-slate-400">%</span>
        <span className="flex-1 text-right text-sm tabular-nums text-slate-900">{formatCents(cents)}</span>
      </div>
    </div>
  );
}
