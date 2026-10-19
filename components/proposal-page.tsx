"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeft,
  Camera,
  KeyRound,
  LoaderCircle,
  MapPin,
  MessageSquare,
  Navigation,
  Pencil,
  Phone,
  User,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { InvoicePanelHost } from "@/components/invoice-panel";
import { JobMathLine } from "@/components/job-math-line";
import { Hint, useBoardRow } from "@/components/proposal-board";
import {
  ProposalActions,
  ProposalDraftFields,
  ProposalRecommended,
  type Proposal,
} from "@/components/proposal-editing";
import { ProposalInvoices } from "@/components/proposal-invoices";
import { ProposalSending } from "@/components/proposal-sending";
import { useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InvoicePanelParam } from "@/lib/invoices";
import { solutionJobInputs } from "@/lib/job-math";
import { formatCents, formatCentsExact } from "@/lib/money";
import type { BoardRow } from "@/lib/proposal-board";
import { telHref } from "@/lib/proposal-paper";
import { proposalPageHref, taxRateField } from "@/lib/proposals";
import { solutionPanelHref } from "@/lib/solutions";
import { cn } from "@/lib/utils";

type LiveSolution = FunctionReturnType<typeof api.solutions.forSite>[number];

// The **Proposal page** (CONTEXT.md): one proposal, the whole job in one
// scroll, and the page the owner works a proposal from. Who and where, with
// Call, Text and Directions; what is offered and for how much, editable while
// it is a draft; Send, or once sent its link with Re-send, Withdraw and Mark
// declined; the invoices once approved; and the paper, the PDF copy,
// Duplicate and Delete under it all. Writing a Solution or changing its price
// still happens on the Site's Solutions tab, one tap away.
//
// The proposal is read by its id and laid out the way the board lays out its
// row, with the same plain hint, so the status line here and the row on the
// board can never say different things.
export function ProposalPage({ proposalId }: { proposalId: string }) {
  const row = useBoardRow(proposalId);

  if (row === undefined) return <Loading />;
  if (!row)
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-16 text-center">
        <p className="text-slate-500">This proposal doesn&rsquo;t exist, or was deleted.</p>
        <BackLink />
      </div>
    );
  return <Loaded row={row} />;
}

function Loaded({ row }: { row: BoardRow }) {
  const siteId = row.siteId as Id<"sites">;
  const router = useRouter();
  const tab = useQuery(api.proposals.forSite, { siteId });
  const paper = useQuery(api.proposals.paper, { proposalId: row.proposalId as Id<"proposals"> });
  const site = useQuery(api.sites.get, { siteId });
  const solutions = useQuery(api.solutions.forSite, { siteId });
  const invoicePanel = useSidePanel(InvoicePanelParam);

  const proposal = tab?.proposals.find((candidate) => candidate.proposalId === row.proposalId);
  if (!tab || !proposal || paper === undefined || !site || !solutions) return <Loading />;

  const phone = site.customerPhone;
  const address = [site.streetLine, site.cityLine].filter(Boolean).join(", ");
  const liveOf = new Map(solutions.map((solution) => [solution._id as string, solution]));
  // The scope of work as the paper prints it: frozen once sent, live before.
  const scopeOf = new Map(
    (paper?.solutions ?? []).map((solution) => [solution.solutionId as string, solution.scopeOfWork]),
  );
  const isDraft = proposal.state === "draft";
  // The mark only means something beside another proposal at the same site.
  const showRecommended = proposal.recommended || tab.proposals.length > 1;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 pb-8">
      <BackLink />

      <header className="space-y-3">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-semibold text-slate-900">{stageLabel(row)}</span>
          <span aria-hidden className="text-slate-300">
            ·
          </span>
          <Hint tone={row.tone}>{row.hint}</Hint>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {row.customerName}
        </h1>
        <div className="space-y-1 text-slate-600">
          <p>{address}</p>
          {site.accessNotes ? (
            <p className="text-sm text-slate-500">
              <KeyRound aria-hidden className="mr-1.5 inline size-3.5" />
              {site.accessNotes}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {phone ? (
            <>
              <ContactLink href={telHref(phone)} icon={<Phone aria-hidden />}>
                Call
              </ContactLink>
              <ContactLink
                href={`sms:${phone.replace(/[^\d+]/g, "")}`}
                icon={<MessageSquare aria-hidden />}
              >
                Text
              </ContactLink>
            </>
          ) : null}
          <ContactLink
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
            icon={<Navigation aria-hidden />}
            external
          >
            Directions
          </ContactLink>
        </div>
      </header>

      <Card>
        <div className="flex items-baseline justify-between gap-3 px-5 pt-5 md:px-6">
          {/* Unnamed, a proposal is called after its solutions, which are
              listed right under; saying them twice is noise. */}
          <h2 className="text-lg font-semibold text-slate-900">{proposal.name ?? "The job"}</h2>
          <span className="shrink-0 text-xs text-slate-400">{proposal.code}</span>
        </div>
        {isDraft ? (
          <div className="space-y-4 px-5 pt-4 pb-5 md:px-6">
            <ProposalDraftFields
              // A withdrawn proposal comes back to Draft: its fields start
              // again from what is saved.
              key={`${proposal.proposalId}-${proposal.state}`}
              tab={tab}
              proposal={proposal}
              noSolutionsHint="This site has no solutions yet. Write one at the site first."
              solutionDetail={(solutionId) => {
                const live = liveOf.get(solutionId);
                return live ? <DraftSolutionDetail solution={live} /> : null;
              }}
            />
            <Link
              href={`/sites/${row.siteId}/solutions`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Pencil aria-hidden className="size-3.5" /> Write a solution or change a price
            </Link>
          </div>
        ) : (
          <>
            <ol className="mt-3 divide-y divide-slate-100">
              {proposal.solutions.map((solution) => (
                <li
                  key={solution.solutionId}
                  className="flex items-start justify-between gap-4 px-5 py-4 md:px-6"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-slate-900">{solution.title}</p>
                    {scopeOf.get(solution.solutionId) ? (
                      <p className="line-clamp-2 text-sm text-slate-500">
                        {scopeOf.get(solution.solutionId)}
                      </p>
                    ) : null}
                    <SoldJobMath
                      live={liveOf.get(solution.solutionId)}
                      soldAtCents={solution.priceCents}
                    />
                  </div>
                  <span className="shrink-0 text-slate-900 tabular-nums">
                    {solution.priceCents === null ? "No price" : formatCents(solution.priceCents)}
                  </span>
                </li>
              ))}
            </ol>
            <Totals proposal={proposal} />
          </>
        )}
      </Card>

      <Card className="p-5 md:p-6">
        <ProposalSending proposal={proposal} customerEmail={tab.customerEmail} />
      </Card>

      {proposal.state === "approved" ? (
        <Card className="space-y-2 p-5 md:p-6">
          <ProposalInvoices proposalId={proposal.proposalId} onOpen={invoicePanel.open} />
        </Card>
      ) : null}

      {showRecommended ? <ProposalRecommended tab={tab} proposal={proposal} /> : null}

      <ProposalActions
        proposal={proposal}
        onDuplicated={(copyId) => router.push(proposalPageHref(copyId))}
        onDeleted={() => router.push("/")}
      />

      <nav className="flex flex-wrap gap-x-5 gap-y-2 px-1 text-sm text-slate-500">
        <SmallLink href={`/sites/${row.siteId}/photos`} icon={<Camera aria-hidden />}>
          Photos{site.counts.photos ? ` (${site.counts.photos})` : ""}
        </SmallLink>
        <SmallLink href={`/sites/${row.siteId}/proposals`} icon={<MapPin aria-hidden />}>
          Everything at this site
        </SmallLink>
        <SmallLink href={`/customers/${row.customerId}`} icon={<User aria-hidden />}>
          Customer details
        </SmallLink>
      </nav>

      <InvoicePanelHost siteId={siteId} />
    </div>
  );
}

// Which column the proposal sits in on the board, said as a stage.
function stageLabel(row: BoardRow): string {
  switch (row.column) {
    case "draft":
      return "Draft";
    case "with_customer":
      return "With the customer";
    case "approved":
      return "Approved";
    case "done":
      return row.state === "declined" ? "Declined" : "Done";
  }
}

// Under a draft's solution: its scope, then its Job math, or where to price
// it when it has no price yet.
function DraftSolutionDetail({ solution }: { solution: LiveSolution }) {
  const inputs = solutionJobInputs(priceable(solution));
  return (
    <span className="mt-0.5 block space-y-0.5">
      {solution.description ? (
        <span className="line-clamp-2 block text-xs text-slate-500">{solution.description}</span>
      ) : null}
      {inputs === null ? (
        <Link
          href={solutionPanelHref(solution.siteId, solution._id)}
          className="block text-xs font-medium text-amber-700 hover:underline"
        >
          No price yet: price it at the site
        </Link>
      ) : (
        <JobMathLine inputs={inputs} />
      )}
    </span>
  );
}

// Job math for a solution as it was sold: the price Send fixed, against the
// hours and costs the solution lists now. Those can have moved since, but
// they are the only hours there are, and the price is the one the customer
// is paying, so this is what the job comes to as best the app knows.
function SoldJobMath({
  live,
  soldAtCents,
}: {
  live: LiveSolution | undefined;
  soldAtCents: number | null;
}) {
  const inputs = live ? solutionJobInputs(priceable(live)) : null;
  if (inputs === null || soldAtCents === null) return null;
  return <JobMathLine inputs={{ ...inputs, priceCents: soldAtCents }} />;
}

// The solution as lib/solution-pricing.ts reads one: the query says "none"
// as null, the pricing module as absent.
function priceable(solution: LiveSolution) {
  return {
    lineItems: solution.lineItems,
    markupPercent: solution.markupPercent,
    materialAllowanceCents: solution.materialAllowanceCents ?? undefined,
  };
}

function Loading() {
  return (
    <div className="grid min-h-64 place-items-center">
      <LoaderCircle aria-label="Loading" className="size-6 animate-spin text-slate-400" />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
    >
      <ArrowLeft aria-hidden className="size-4" /> Proposals
    </Link>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/5",
        className,
      )}
    >
      {children}
    </section>
  );
}

function ContactLink({
  href,
  icon,
  external = false,
  children,
}: {
  href: string;
  icon: ReactNode;
  external?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      className="rounded-full px-4"
      nativeButton={false}
      render={<a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} />}
    >
      {icon}
      {children}
    </Button>
  );
}

function SmallLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 hover:text-slate-900 [&_svg]:size-3.5"
    >
      {icon}
      {children}
    </Link>
  );
}

// The money of a proposal past Draft, as Send fixed it: before tax, the tax,
// a big total, and how the Deposit splits it.
function Totals({ proposal }: { proposal: Proposal }) {
  const { money, payment, tax } = proposal;
  const showDeposit = payment.depositCents > 0 && payment.balanceCents > 0;
  return (
    <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-5 py-5 md:px-6">
      <dl className="space-y-1 text-sm text-slate-500">
        <div className="flex justify-between">
          <dt>Before tax</dt>
          <dd className="tabular-nums">{formatCentsExact(money.subtotalCents)}</dd>
        </div>
        {tax.source !== "none" ? (
          <div className="flex justify-between">
            <dt>Sales tax{tax.rate !== undefined ? ` (${taxRateField(tax.rate)}%)` : ""}</dt>
            <dd className="tabular-nums">{formatCentsExact(money.taxCents)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-medium text-slate-900">Total</span>
        <span className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {formatCentsExact(money.totalCents)}
        </span>
      </div>
      {showDeposit ? (
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900 tabular-nums">
            {formatCentsExact(payment.depositCents)}
          </span>{" "}
          on signing, then{" "}
          <span className="font-medium text-slate-900 tabular-nums">
            {formatCentsExact(payment.balanceCents)}
          </span>{" "}
          when the job is done.
        </p>
      ) : null}
    </div>
  );
}
