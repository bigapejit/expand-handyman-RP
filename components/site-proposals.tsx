"use client";

import { useAction, useQuery } from "convex/react";
import { Plus, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StageChip } from "@/components/deal-chips";
import { HubEmpty, HubLoading, HubSection } from "@/components/hub-section";
import { InvoicePanelHost } from "@/components/invoice-panel";
import { OpenedChip, ProposalStateChip } from "@/components/proposal-chips";
import {
  OfferedSolutions,
  ProposalActions,
  ProposalDraftFields,
  ProposalMoney,
  ProposalRecommended,
  type Proposal,
  type ProposalsTab,
} from "@/components/proposal-editing";
import { ProposalInvoices } from "@/components/proposal-invoices";
import { ProposalSending } from "@/components/proposal-sending";
import { SidePanel, useSidePanel } from "@/components/side-panel";
import { SiteTag } from "@/components/site-tag";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InvoicePanelParam } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import { ProposalPanelParam, proposalPageHref, proposalStateLabel } from "@/lib/proposals";
import { errorMessage } from "@/lib/utils";

// The Proposals tab, ported from FRSG's site-proposals.tsx: the site page's
// landing tab. Opening a row slides the panel in over the list and puts the
// proposal in the URL, exactly as the Solutions tab does.
export function SiteProposals({ siteId }: { siteId: Id<"sites"> }) {
  const tab = useQuery(api.proposals.forSite, { siteId });
  // An action rather than a mutation: a Washington site's tax rate comes from
  // the Department of Revenue, and the new draft carries it from the start.
  const create = useAction(api.proposals.create);
  // The open deals a proposal here could be for: New proposal makes the
  // draft for the one there is, or asks which when there are more.
  const openDeals = useQuery(api.deals.openAtSite, { siteId });
  const [choosing, setChoosing] = useState(false);
  const { openId, open, close } = useSidePanel(ProposalPanelParam);
  // An invoice opened from an approved proposal's panel takes the panel's
  // place, and closing it brings the proposal back.
  const invoicePanel = useSidePanel(InvoicePanelParam);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  // A link naming a proposal since deleted just shows the list.
  const openProposal = tab?.proposals.find((proposal) => proposal.proposalId === openId);
  const count = tab?.proposals.length ?? 0;

  const make = async (dealId?: Id<"deals">) => {
    setChoosing(false);
    setAdding(true);
    setError("");
    try {
      // "New proposal" means "assemble one", so it opens straight away.
      open(await create({ siteId, ...(dealId ? { dealId } : {}) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };
  const add = () => {
    const could = openDeals ?? [];
    if (could.length > 1) setChoosing(true);
    else void make(could[0]?.dealId);
  };

  return (
    <HubSection
      title="Proposals"
      description={
        count
          ? `${count === 1 ? "1 proposal" : `${count} proposals`}: the offers made for this site.`
          : "Offers for this site, each assembled from solutions."
      }
      action={
        <Button variant="outline" size="lg" disabled={adding || !openDeals} onClick={add}>
          <Plus data-icon="inline-start" aria-hidden /> New proposal
        </Button>
      }
    >
      {choosing ? (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setChoosing(false);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Which deal is this proposal for?</DialogTitle>
              <DialogDescription>
                This customer has more than one open deal here. Send moves the one you pick. Not
                one of these? Add the deal on the Pipeline first.
              </DialogDescription>
            </DialogHeader>
            <ul className="grid gap-2">
              {(openDeals ?? []).map((deal) => (
                <li key={deal.dealId}>
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full justify-between"
                    onClick={() => void make(deal.dealId)}
                  >
                    <span className="truncate">{deal.title}</span>
                    <StageChip stage={deal.stage} />
                  </Button>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      ) : null}
      {error ? (
        <p role="alert" className="border-b px-5 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {tab === undefined ? (
        <HubLoading label="Loading proposals" />
      ) : tab.proposals.length === 0 ? (
        <HubEmpty>
          No proposals yet. Assemble one from this site&rsquo;s solutions; a site can
          have several, each offering a different set.
        </HubEmpty>
      ) : (
        <ol>
          {tab.proposals.map((proposal) => (
            <ProposalRow
              key={proposal.proposalId}
              proposal={proposal}
              open={() => open(proposal.proposalId)}
            />
          ))}
        </ol>
      )}
      <InvoicePanelHost
        siteId={siteId}
        otherwise={
          tab && openProposal ? (
            <ProposalPanel
              key={openProposal.proposalId}
              tab={tab}
              proposal={openProposal}
              onOpen={open}
              onOpenInvoice={invoicePanel.open}
              onClose={close}
            />
          ) : null
        }
      />
    </HubSection>
  );
}

// Every row is at the same site, so none repeats the site's name.
function ProposalRow({ proposal, open }: { proposal: Proposal; open: () => void }) {
  const solutions = proposal.solutions.length;
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="min-w-0 flex-1">
          {/* Expand: the chips drop under the title on a phone rather than
              squeezing it down to its code. */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="max-w-full truncate font-medium text-slate-900">
              <span className="text-slate-500">{proposal.code}</span> · {proposal.title}
            </span>
            <ProposalStateChip state={proposal.state} />
            {proposal.state === "sent" && proposal.opened ? <OpenedChip /> : null}
            {proposal.recommended ? <RecommendedMark /> : null}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {solutions === 1 ? "1 solution" : `${solutions} solutions`}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
          {formatCents(proposal.money.totalCents)}
        </span>
      </button>
    </li>
  );
}

function RecommendedMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
      <Star aria-hidden className="size-3" /> Recommended
    </span>
  );
}

// Where a draft is assembled and sent, on the site page. The proposal page
// does the same in more room (components/proposal-page.tsx); both edit
// through components/proposal-editing.tsx. Past Draft the panel reads the
// offer Send froze, and acts only on its signing link.
function ProposalPanel({
  tab,
  proposal,
  onOpen,
  onOpenInvoice,
  onClose,
}: {
  tab: ProposalsTab;
  proposal: Proposal;
  onOpen: (proposalId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onClose: () => void;
}) {
  return (
    <SidePanel
      title={proposal.title}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <SiteTag name={proposal.siteName} />
          <span aria-hidden>·</span>
          <span>{proposal.code}</span>
          <span aria-hidden>·</span>
          <span>{proposalStateLabel(proposal.state)}</span>
          <span aria-hidden>·</span>
          <Link
            href={proposalPageHref(proposal.proposalId)}
            className="font-medium text-primary hover:underline"
          >
            Open its page
          </Link>
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        {proposal.state === "draft" ? (
          <ProposalDraftFields
            // A withdrawn proposal comes back to Draft: its fields start again
            // from what is saved.
            key={proposal.state}
            tab={tab}
            proposal={proposal}
            noSolutionsHint="This site has no solutions yet. Price one on the Solutions tab first."
          />
        ) : (
          <>
            <OfferedSolutions proposal={proposal} />
            <ProposalMoney proposal={proposal} />
          </>
        )}

        <ProposalRecommended tab={tab} proposal={proposal} />

        <ProposalSending proposal={proposal} customerEmail={tab.customerEmail} />

        {proposal.state === "approved" ? (
          <ProposalInvoices proposalId={proposal.proposalId} onOpen={onOpenInvoice} />
        ) : null}

        <div className="border-t pt-4">
          <ProposalActions proposal={proposal} onDuplicated={onOpen} onDeleted={onClose} />
        </div>
      </div>
    </SidePanel>
  );
}
