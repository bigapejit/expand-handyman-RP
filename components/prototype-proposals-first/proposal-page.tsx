"use client";

import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeft,
  Camera,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Navigation,
  Pencil,
  Phone,
  Send,
} from "lucide-react";
import Link from "next/link";
import { Component, useState, type ReactNode } from "react";

import { useAppOrigin, CopyLinkButton } from "@/components/copy-link";
import { InvoicePanelHost } from "@/components/invoice-panel";
import { ProposalInvoices } from "@/components/proposal-invoices";
import { useBoard, type BoardRow } from "@/components/prototype-proposals-first/board";
import { PrototypeBar } from "@/components/prototype-proposals-first/prototype-bar";
import { SidePanel, useSidePanel } from "@/components/side-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { InvoicePanelParam, invoicePaperHref } from "@/lib/invoices";
import { formatCents, formatCentsExact } from "@/lib/money";
import { telHref } from "@/lib/proposal-paper";
import { sendBlockerMessage } from "@/lib/proposal-pricing";
import { proposalPanelHref, proposalPaperHref } from "@/lib/proposals";
import { signingPath } from "@/lib/signing-link";
import { cn, errorMessage } from "@/lib/utils";

type Tab = FunctionReturnType<typeof api.proposals.forSite>;
type Proposal = Tab["proposals"][number];

// PROTOTYPE (proposals-first): throwaway. One proposal, the whole job in one
// scroll: who and where, what is offered and for how much, the one thing to
// do next, then the money that came of it. Real data from existing queries;
// Send, Copy link, Job done and the invoice panel are the real ones. Editing
// a draft's solutions still happens in the existing site panel, one tap away.
export function ProposalPage({ proposalId }: { proposalId: string }) {
  const board = useBoard();
  const row = board?.rows.find((candidate) => candidate.proposalId === proposalId);

  if (board === undefined) return <Loading />;
  if (!row)
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <PrototypeBar />
        <p className="text-slate-500">This proposal doesn&rsquo;t exist, or was deleted.</p>
        <BackLink />
      </div>
    );
  return <Loaded row={row} />;
}

function Loaded({ row }: { row: BoardRow }) {
  const tab = useQuery(api.proposals.forSite, { siteId: row.siteId });
  const paper = useQuery(api.proposals.paper, { proposalId: row.proposalId });
  const site = useQuery(api.sites.get, { siteId: row.siteId });
  const customers = useQuery(api.customers.list);
  const invoicePanel = useSidePanel(InvoicePanelParam);

  const proposal = tab?.proposals.find((candidate) => candidate.proposalId === row.proposalId);
  if (!tab || !proposal || paper === undefined || !site || !customers) return <Loading />;
  const customer = customers.find((candidate) => candidate._id === row.customerId);
  const scopeOf = new Map(
    (paper?.solutions ?? []).map((solution) => [solution.solutionId, solution.scopeOfWork]),
  );
  const address = [site.streetLine, site.cityLine].filter(Boolean).join(", ");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <PrototypeBar />
      <BackLink />

      <header className="space-y-3">
        <StatusLine row={row} />
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
          {customer?.phone ? (
            <>
              <ContactLink href={telHref(customer.phone)} icon={<Phone aria-hidden />}>
                Call
              </ContactLink>
              <ContactLink
                href={`sms:${customer.phone.replace(/[^\d+]/g, "")}`}
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
        {proposal.solutions.length === 0 ? (
          <p className="px-5 py-6 text-slate-500 md:px-6">No solutions in it yet.</p>
        ) : (
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
                </div>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    solution.priceCents === null ? "text-amber-700" : "text-slate-900",
                  )}
                >
                  {solution.priceCents === null ? "No price" : formatCents(solution.priceCents)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <Totals proposal={proposal} />
      </Card>

      <NextStep proposal={proposal} customerEmail={tab.customerEmail} />

      {proposal.state === "approved" ? (
        <Card className="space-y-2 p-5 md:p-6">
          <ProposalInvoices proposalId={proposal.proposalId} onOpen={invoicePanel.open} />
        </Card>
      ) : null}

      <nav className="flex flex-wrap gap-x-5 gap-y-2 px-1 pb-8 text-sm text-slate-500">
        <SmallLink href={`/sites/${row.siteId}/photos`} icon={<Camera aria-hidden />}>
          Photos{site.counts.photos ? ` (${site.counts.photos})` : ""}
        </SmallLink>
        <SmallLink href={proposalPaperHref(proposal.proposalId)} icon={<ExternalLink aria-hidden />} newTab>
          See what the customer sees
        </SmallLink>
        <SmallLink href={`/sites/${row.siteId}/proposals`}>
          Everything at this site
        </SmallLink>
        <SmallLink href={`/customers/${row.customerId}`}>Customer details</SmallLink>
      </nav>

      {/* Keyed by the open invoice, so a failure is forgotten on the next. */}
      <PanelGuard
        key={invoicePanel.openId ?? "closed"}
        invoiceId={invoicePanel.openId}
        onClose={invoicePanel.close}
      >
        <InvoicePanelHost siteId={row.siteId} />
      </PanelGuard>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid min-h-64 place-items-center">
      <PrototypeBar />
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

function StatusLine({ row }: { row: BoardRow }) {
  const stage = {
    draft: "Draft",
    waiting: "Waiting on the customer",
    approved: "Approved",
    done: row.state === "declined" ? "Declined" : "Done",
  }[row.group];
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm">
      <span className="font-semibold text-slate-900">{stage}</span>
      <span aria-hidden className="text-slate-300">
        ·
      </span>
      <span
        className={cn(
          row.tone === "attention" && "font-medium text-red-700",
          row.tone === "nudge" && "text-amber-800",
          row.tone === "good" && "text-emerald-700",
          row.tone === "quiet" && "text-slate-500",
        )}
      >
        {row.hint}
      </span>
    </p>
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
  newTab = false,
  children,
}: {
  href: string;
  icon?: ReactNode;
  newTab?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex items-center gap-1.5 hover:text-slate-900 [&_svg]:size-3.5"
    >
      {icon}
      {children}
    </Link>
  );
}

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
        <div className="flex justify-between">
          <dt>Sales tax{tax.rate !== undefined ? ` (${+(tax.rate * 100).toFixed(2)}%)` : ""}</dt>
          <dd className="tabular-nums">{formatCentsExact(money.taxCents)}</dd>
        </div>
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

// The one thing to do next, by stage. Draft: send it. Sent: hand over the
// link. Decided: say what the customer said.
function NextStep({
  proposal,
  customerEmail,
}: {
  proposal: Proposal;
  customerEmail: string | null;
}) {
  if (proposal.state === "draft")
    return <SendDraft proposal={proposal} customerEmail={customerEmail} />;
  if (proposal.state === "sent") return <SentLink proposal={proposal} />;
  const day = (at: number | null) =>
    at
      ? new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(at)
      : "";
  if (proposal.state === "approved")
    return (
      <p className="px-1 text-slate-600">
        Signed by <span className="font-medium text-slate-900">{proposal.signerName}</span>{" "}
        on {day(proposal.approvedAt)}.
      </p>
    );
  return (
    <div className="space-y-1 px-1 text-slate-600">
      <p>
        Declined on {day(proposal.declinedAt)}
        {proposal.declinedBy === "owner" ? " (you marked it)" : ""}.
      </p>
      {proposal.declineReason ? (
        <p className="text-slate-500">&ldquo;{proposal.declineReason}&rdquo;</p>
      ) : null}
    </div>
  );
}

function SendDraft({
  proposal,
  customerEmail,
}: {
  proposal: Proposal;
  customerEmail: string | null;
}) {
  const send = useAction(api.proposals.send);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const blocked = proposal.sendBlockers.length > 0;

  return (
    <Card className="space-y-4 p-5 md:p-6">
      {blocked ? (
        <div className="space-y-1">
          <p className="font-medium text-slate-900">Before it can go:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
            {proposal.sendBlockers.map((blocker) => (
              <li key={blocker}>{sendBlockerMessage(blocker)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-slate-600">
          Ready to go to <span className="font-medium text-slate-900">{customerEmail}</span>.
        </p>
      )}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          className="h-11 px-5 text-base max-md:w-full"
          disabled={blocked || sending}
          onClick={() => setConfirming(true)}
        >
          <Send data-icon="inline-start" aria-hidden /> {sending ? "Sending…" : "Send proposal"}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="h-11 text-slate-600 max-md:w-full"
          nativeButton={false}
          render={<Link href={proposalPanelHref(proposal.siteId, proposal.proposalId)} />}
        >
          <Pencil data-icon="inline-start" aria-hidden /> Change solutions or deposit
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send it to {customerEmail}?</AlertDialogTitle>
            <AlertDialogDescription>
              They get an email with a private link to read and sign it. It can&rsquo;t be
              changed after this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirming(false);
                setSending(true);
                try {
                  await send({ proposalId: proposal.proposalId });
                  setError("");
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setSending(false);
                }
              }}
            >
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SentLink({ proposal }: { proposal: Proposal }) {
  const origin = useAppOrigin();
  const url =
    proposal.liveUrl ??
    (proposal.liveToken && origin ? `${origin}${signingPath(proposal.liveToken)}` : "");
  return (
    <Card className="space-y-3 p-5 md:p-6">
      <p className="text-slate-600">
        {proposal.sentTo ? (
          <>
            Emailed to <span className="font-medium text-slate-900">{proposal.sentTo}</span>.{" "}
          </>
        ) : null}
        Want to text it too? Copy the link.
      </p>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <CopyLinkButton url={url} label="Copy the link" />
        </div>
      ) : null}
      <Link
        href={proposalPanelHref(proposal.siteId, proposal.proposalId)}
        className="inline-block text-sm text-slate-500 hover:text-slate-900 hover:underline"
      >
        Re-send, take it back, or mark it declined →
      </Link>
    </Card>
  );
}

// The shared dev Convex deployment is sometimes a step behind this branch's
// code (whoever ran `convex dev` last wins), and the invoice panel then reads
// fields the server does not send yet. The prototype must not deploy, so a
// panel that falls over says so instead of taking the page down.
class PanelGuard extends Component<
  { children: ReactNode; invoiceId: string | null; onClose: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    const { invoiceId, onClose } = this.props;
    if (!this.state.failed) return this.props.children;
    if (!invoiceId) return null;
    return (
      <SidePanel title="Invoice" onClose={onClose}>
        <div className="space-y-3 pt-5 text-sm text-slate-600">
          <p>
            The invoice panel can&rsquo;t open right now: the shared dev backend is behind
            this code. Nothing is wrong with the invoice.
          </p>
          <a
            href={invoicePaperHref(invoiceId)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Open the invoice paper instead
          </a>
        </div>
      </SidePanel>
    );
  }
}
