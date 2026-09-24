"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  GripVertical,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { HubEmpty, HubLoading, HubSection } from "@/components/hub-section";
import { InvoicePanelHost } from "@/components/invoice-panel";
import { pdfDownloadLabel, usePdfDownload } from "@/components/pdf-download";
import { OpenedChip, ProposalStateChip } from "@/components/proposal-chips";
import { ProposalInvoices } from "@/components/proposal-invoices";
import { ProposalSending } from "@/components/proposal-sending";
import { FieldHeading, FieldLabel, SidePanel, useSidePanel } from "@/components/side-panel";
import { SiteTag } from "@/components/site-tag";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InvoicePanelParam } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import { pdfCopyStateFor } from "@/lib/pdf-copy";
import {
  paymentRowLabels,
  proposalFaultMessage,
  splitPayment,
  type Deposit,
} from "@/lib/proposal-pricing";
import {
  dollarsField,
  moveInOrder,
  ProposalPanelParam,
  proposalPaperHref,
  proposalStateLabel,
  readDollarsField,
  readPercentField,
  readTaxRateField,
  reorder,
  solutionPickLabel,
  taxRateField,
  taxSourceLine,
} from "@/lib/proposals";
import { cn, errorMessage } from "@/lib/utils";

type ProposalsTab = FunctionReturnType<typeof api.proposals.forSite>;
type Proposal = ProposalsTab["proposals"][number];
type OfferedSolution = ProposalsTab["solutions"][number];
type ProposalPatch = Omit<FunctionArgs<typeof api.proposals.update>, "proposalId">;

// The Proposals tab, ported from FRSG's site-proposals.tsx: the site page's
// landing tab. Opening a row slides the panel in over the list and puts the
// proposal in the URL, exactly as the Solutions tab does.
export function SiteProposals({ siteId }: { siteId: Id<"sites"> }) {
  const tab = useQuery(api.proposals.forSite, { siteId });
  // An action rather than a mutation: a Washington site's tax rate comes from
  // the Department of Revenue, and the new draft carries it from the start.
  const create = useAction(api.proposals.create);
  const { openId, open, close } = useSidePanel(ProposalPanelParam);
  // An invoice opened from an approved proposal's panel takes the panel's
  // place, and closing it brings the proposal back.
  const invoicePanel = useSidePanel(InvoicePanelParam);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  // A link naming a proposal since deleted just shows the list.
  const openProposal = tab?.proposals.find((proposal) => proposal.proposalId === openId);
  const count = tab?.proposals.length ?? 0;

  const add = async () => {
    setAdding(true);
    setError("");
    try {
      // "New proposal" means "assemble one", so it opens straight away.
      open(await create({ siteId }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
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
        <Button variant="outline" size="lg" disabled={adding} onClick={() => void add()}>
          <Plus data-icon="inline-start" aria-hidden /> New proposal
        </Button>
      }
    >
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
          <span className="flex items-center gap-2">
            <span className="truncate font-medium text-slate-900">
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

// Where a draft is assembled and sent. Text commits when the field is left, so
// a half-typed name never becomes the proposal; a tick or a move commits at
// once, because there is nothing partial about either. Past Draft the panel
// reads the offer Send froze, and acts only on its signing link.
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
  const update = useMutation(api.proposals.update);
  const setRecommended = useMutation(api.proposals.setRecommended);
  const duplicate = useMutation(api.proposals.duplicate);
  const remove = useMutation(api.proposals.remove);
  const [name, setName] = useState(proposal.name ?? "");
  const [notes, setNotes] = useState(proposal.notes ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // A refusal belongs where the edit was made: the tab's own error line is
  // behind the panel.
  const [refusal, setRefusal] = useState("");

  const isDraft = proposal.state === "draft";
  const pdfState = pdfCopyStateFor(proposal.state);
  const pdf = usePdfDownload(pdfState ? { proposalId: proposal.proposalId } : null);
  const shownRefusal = refusal || pdf.fault;

  const save = async (patch: ProposalPatch): Promise<boolean> => {
    try {
      await update({ proposalId: proposal.proposalId, ...patch });
      setRefusal("");
      return true;
    } catch (err) {
      setRefusal(errorMessage(err));
      return false;
    }
  };

  const attempt = async (act: () => Promise<unknown>) => {
    try {
      await act();
      setRefusal("");
    } catch (err) {
      setRefusal(errorMessage(err));
    }
  };

  // Each tick and each move builds on what the previous one left behind rather
  // than on a query result that has yet to catch up: two ticks in quick
  // succession would otherwise both start from the same stale list, and the
  // second would silently drop the first. A refusal puts the order back.
  const [picked, setPicked] = useState<Id<"solutions">[]>(
    proposal.solutions.map((solution) => solution.solutionId),
  );
  const commitOrder = async (next: Id<"solutions">[]) => {
    const previous = picked;
    setPicked(next);
    if (!(await save({ solutionIds: next }))) setPicked(previous);
  };

  // The tab is one site's, so every solution on it is one this draft may offer.
  const bySolutionId = new Map(
    tab.solutions.map((solution) => [solution.solutionId, solution] as const),
  );
  // A solution deleted while the panel is open is dropped here too, so the
  // next tick never sends an id the server would refuse.
  const current = picked.filter((solutionId) => bySolutionId.has(solutionId));
  const held = new Set(current);
  const offered = current.flatMap((solutionId) => bySolutionId.get(solutionId) ?? []);
  const available = tab.solutions.filter((solution) => !held.has(solution.solutionId));

  const alreadyRecommended = tab.proposals.find(
    (other) => other.recommended && other.proposalId !== proposal.proposalId,
  );

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
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        {shownRefusal ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {shownRefusal}
          </p>
        ) : null}

        {isDraft ? (
          <>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="proposal-name">Name</FieldLabel>
              <Input
                id="proposal-name"
                value={name}
                placeholder={proposal.title}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  if (name.trim() !== (proposal.name ?? "")) void save({ name });
                }}
                className="w-full bg-white font-medium"
              />
              <p className="text-xs text-slate-500">
                Leave this empty and the proposal is called after the solutions it offers.
              </p>
            </div>

            <SolutionPicker
              offered={offered}
              available={available}
              onReorder={(from, to) => void commitOrder(reorder(current, from, to))}
              onMove={(index, direction) =>
                void commitOrder(moveInOrder(current, index, direction))
              }
              onToggle={(solutionId) =>
                void commitOrder(
                  held.has(solutionId)
                    ? current.filter((id) => id !== solutionId)
                    : [...current, solutionId],
                )
              }
            />

            <div className="space-y-1.5">
              <FieldLabel htmlFor="proposal-notes">Notes and exclusions</FieldLabel>
              <Textarea
                id="proposal-notes"
                value={notes}
                placeholder="Anything the scopes of work don't already say…"
                onChange={(event) => setNotes(event.target.value)}
                onBlur={() => {
                  if (notes.trim() !== (proposal.notes ?? "")) void save({ notes });
                }}
                className="min-h-24 bg-white"
              />
              <p className="text-xs text-slate-500">
                What the job leaves out or depends on: permits, access, scheduling. Leave
                it empty and the proposal prints nothing here.
              </p>
            </div>
          </>
        ) : (
          <OfferedSolutions proposal={proposal} />
        )}

        <MoneyBlock proposal={proposal} editable={isDraft} save={save} />

        <RecommendedToggle
          recommended={proposal.recommended}
          heldBy={alreadyRecommended?.title ?? null}
          onSet={(recommended) =>
            attempt(() => setRecommended({ proposalId: proposal.proposalId, recommended }))
          }
        />

        <ProposalSending proposal={proposal} customerEmail={tab.customerEmail} />

        {proposal.state === "approved" ? (
          <ProposalInvoices proposalId={proposal.proposalId} onOpen={onOpenInvoice} />
        ) : null}

        <div className="flex flex-wrap items-center gap-1 border-t pt-4">
          <Button
            variant="outline"
            onClick={() =>
              void attempt(async () =>
                onOpen(await duplicate({ proposalId: proposal.proposalId })),
              )
            }
          >
            <Copy data-icon="inline-start" aria-hidden /> Duplicate
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={proposalPaperHref(proposal.proposalId)}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <Eye data-icon="inline-start" aria-hidden /> View paper
          </Button>
          {pdfState ? (
            <Button variant="outline" disabled={!pdf.ready} onClick={() => void pdf.download()}>
              <Download data-icon="inline-start" aria-hidden />
              {pdfDownloadLabel(pdfState, pdf.working)}
            </Button>
          ) : null}
          <span className="flex-1" />
          {isDraft ? (
            <Button variant="destructive" size="lg" onClick={() => setConfirmingDelete(true)}>
              <Trash2 data-icon="inline-start" aria-hidden /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {proposal.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              The solutions it offered stay on the site. Its number isn&rsquo;t reused.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirmingDelete(false);
                try {
                  await remove({ proposalId: proposal.proposalId });
                  onClose();
                } catch (err) {
                  setRefusal(errorMessage(err));
                }
              }}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidePanel>
  );
}

// The solutions a proposal past Draft offers, read only.
function OfferedSolutions({ proposal }: { proposal: Proposal }) {
  return (
    <div className="space-y-2">
      <FieldHeading>Solutions in this proposal</FieldHeading>
      <ol className="divide-y overflow-hidden rounded-xl border">
        {proposal.solutions.map((solution) => (
          <li
            key={solution.solutionId}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate text-slate-900">{solution.title}</span>
            <span className="shrink-0 tabular-nums text-slate-900">
              {solutionPickLabel(solution.priceCents)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SolutionPicker({
  offered,
  available,
  onReorder,
  onMove,
  onToggle,
}: {
  offered: OfferedSolution[];
  available: OfferedSolution[];
  onReorder: (from: number, to: number) => void;
  onMove: (index: number, direction: "up" | "down") => void;
  onToggle: (solutionId: Id<"solutions">) => void;
}) {
  // Which row is being carried. Held here rather than read off the drag event
  // because the browser only hands the payload back on drop, and the list has
  // to show where the row would land while it is still in the air.
  const [carrying, setCarrying] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      <FieldHeading>Solutions in this proposal</FieldHeading>

      {offered.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-slate-500">
          {available.length === 0
            ? "This site has no solutions yet. Price one on the Solutions tab first."
            : "Nothing yet. Tick the solutions this proposal offers."}
        </p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-xl border">
          {offered.map((solution, index) => (
            <li
              key={solution.solutionId}
              draggable
              onDragStart={() => setCarrying(index)}
              onDragEnd={() => {
                setCarrying(null);
                setOver(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (carrying !== null) onReorder(carrying, index);
                setCarrying(null);
                setOver(null);
              }}
              className={cn(
                "flex items-center gap-2 bg-white px-3 py-2 text-sm",
                carrying === index && "opacity-50",
                over === index && carrying !== index && "bg-slate-50",
              )}
            >
              <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-slate-300" />
              <input
                type="checkbox"
                checked
                aria-label={`Remove ${solution.title} from this proposal`}
                onChange={() => onToggle(solution.solutionId)}
                className="size-4 shrink-0 accent-slate-900"
              />
              <span className="min-w-0 flex-1 truncate text-slate-900">{solution.title}</span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  solution.price === null ? "text-amber-700" : "font-medium text-slate-900",
                )}
              >
                {solutionPickLabel(solution.price?.priceCents ?? null)}
              </span>
              <span className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${solution.title} up`}
                  disabled={index === 0}
                  onClick={() => onMove(index, "up")}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${solution.title} down`}
                  disabled={index === offered.length - 1}
                  onClick={() => onMove(index, "down")}
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
          <FieldHeading>Also written for this site</FieldHeading>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {available.map((solution) => (
              <li
                key={solution.solutionId}
                className="flex items-center gap-2 bg-white px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={false}
                  aria-label={`Add ${solution.title} to this proposal`}
                  onChange={() => onToggle(solution.solutionId)}
                  className="ml-6 size-4 shrink-0 accent-slate-900"
                />
                <span className="min-w-0 flex-1 truncate text-slate-700">{solution.title}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    solution.price === null ? "text-amber-700" : "text-slate-900",
                  )}
                >
                  {solutionPickLabel(solution.price?.priceCents ?? null)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// The Money block, in the order the proposal paper prints it: the Deposit and
// the Balance, then subtotal, sales tax and total. Each payment row is labelled
// exactly as the paper will label it, so the block is also the preview. The
// tax row is absent altogether outside Washington — not zero, absent — and
// where it is charged it says which rate and where that rate came from.
//
// The Deposit is a whole percent or a set amount (CONTEXT.md, **Deposit**).
// The rows follow the field as it is typed; leaving the field is what saves
// it, as everywhere in the panel, and switching kinds saves at once, because
// there is nothing half-typed about a switch.
function MoneyBlock({
  proposal,
  editable,
  save,
}: {
  proposal: Proposal;
  editable: boolean;
  save: (patch: ProposalPatch) => Promise<boolean>;
}) {
  const saved = proposal.payment.deposit;
  const totalCents = proposal.money.totalCents;
  const [kind, setKind] = useState<Deposit["kind"]>(saved.kind);
  const [percent, setPercent] = useState(String(proposal.depositPercent));
  const [dollars, setDollars] = useState(saved.kind === "amount" ? dollarsField(saved.cents) : "");
  const [depositFault, setDepositFault] = useState("");
  const [rate, setRate] = useState(taxRateField(proposal.tax.rate));
  const source = taxSourceLine(proposal.tax);
  const taxed = proposal.tax.source !== "none";

  // The Deposit as the field reads right now, or nothing while it is not yet
  // a figure. A panel that cannot edit shows only what was saved.
  const typedPercent = readPercentField(percent);
  const typedCents = readDollarsField(dollars);
  const deposit: Deposit | null = !editable
    ? saved
    : kind === "percent"
      ? typedPercent === null || typedPercent > 100
        ? null
        : { kind: "percent", percent: typedPercent }
      : typedCents === null
        ? null
        : { kind: "amount", cents: typedCents };
  const split = deposit ? splitPayment(totalCents, deposit) : null;
  const labels = deposit
    ? paymentRowLabels(deposit)
    : kind === "percent"
      ? { deposit: "—% due on signing", balance: "—% due on completion" }
      : paymentRowLabels({ kind: "amount", cents: 0 });
  const overTotal = split !== null && split.balanceCents < 0;

  // A percent the field cannot make whole snaps back to the one saved.
  const commitPercent = () => {
    if (typedPercent === null || typedPercent > 100) {
      setPercent(String(proposal.depositPercent));
      return;
    }
    if (saved.kind === "percent" && typedPercent === saved.percent) return;
    void save({ depositPercent: typedPercent }).then((ok) => {
      if (!ok) setPercent(String(proposal.depositPercent));
    });
  };

  // So does a set amount that is not a figure, or that asks for more than the
  // proposal comes to. The server refuses the second too; it is caught here so
  // the reason sits beside the field rather than at the top of the panel.
  const commitDollars = () => {
    const back = saved.kind === "amount" ? dollarsField(saved.cents) : "";
    if (typedCents === null) {
      setDollars(back);
      return;
    }
    if (typedCents > totalCents) {
      setDepositFault(proposalFaultMessage("deposit_over_total"));
      setDollars(back);
      return;
    }
    setDollars(dollarsField(typedCents));
    if (saved.kind === "amount" && typedCents === saved.cents) return;
    void save({ depositCents: typedCents }).then((ok) => {
      if (!ok) setDollars(back);
    });
  };

  // A set amount starts from what the percent comes to, so the owner edits a
  // figure rather than facing an empty box; going back to a percent finds the
  // one the proposal kept.
  const switchTo = (next: Deposit["kind"]) => {
    if (next === kind) return;
    setDepositFault("");
    setKind(next);
    if (next === "amount") {
      const cents = splitPayment(totalCents, {
        kind: "percent",
        percent: proposal.depositPercent,
      }).depositCents;
      setDollars(dollarsField(cents));
      void save({ depositCents: cents }).then((ok) => {
        if (!ok) setKind("percent");
      });
    } else {
      setPercent(String(proposal.depositPercent));
      void save({ depositPercent: proposal.depositPercent }).then((ok) => {
        if (!ok) setKind("amount");
      });
    }
  };

  const commitRate = () => {
    const typed = readTaxRateField(rate);
    if (typed === null || typed === proposal.tax.rate) {
      setRate(taxRateField(proposal.tax.rate));
      return;
    }
    void save({ taxRate: typed }).then((ok) => {
      if (!ok) setRate(taxRateField(proposal.tax.rate));
    });
  };

  return (
    <div className="space-y-2">
      <FieldHeading>Money</FieldHeading>
      <dl className="space-y-2 rounded-xl border px-3 py-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <dt className="min-w-0 text-slate-900">
            <span>{labels.deposit}</span>
            {editable ? (
              <span className="mt-0.5 flex gap-1 text-xs">
                {(["percent", "amount"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={kind === option}
                    onClick={() => switchTo(option)}
                    className={cn(
                      "rounded px-1.5 py-0.5",
                      kind === option
                        ? "bg-slate-900 text-white"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    {option === "percent" ? "% of total" : "Set amount"}
                  </button>
                ))}
              </span>
            ) : null}
          </dt>
          <dd className="flex shrink-0 items-center gap-2">
            {editable && kind === "percent" ? (
              <>
                <Input
                  aria-label="Deposit, percent of the total"
                  inputMode="numeric"
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                  onBlur={commitPercent}
                  className="w-20 bg-white text-right"
                />
                <span className="w-3 text-xs text-slate-400">%</span>
              </>
            ) : null}
            {editable && kind === "amount" ? (
              <>
                <span className="text-xs text-slate-400">$</span>
                <Input
                  aria-label="Deposit, set amount"
                  inputMode="decimal"
                  value={dollars}
                  onChange={(event) => {
                    setDollars(event.target.value);
                    setDepositFault("");
                  }}
                  onBlur={commitDollars}
                  className="w-[5.75rem] bg-white text-right"
                />
              </>
            ) : null}
            <PaymentAmount cents={split?.depositCents ?? null} over={overTotal} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-b pb-2">
          <dt className="text-slate-900">{labels.balance}</dt>
          <dd>
            <PaymentAmount cents={overTotal ? null : (split?.balanceCents ?? null)} />
          </dd>
        </div>
        <div className="flex justify-between gap-6 text-slate-500">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{formatCents(proposal.money.subtotalCents)}</dd>
        </div>
        {taxed ? (
          <div className="flex items-start justify-between gap-4 text-slate-500">
            <dt className="min-w-0">
              <span>Sales tax</span>
              {source ? (
                <span
                  className={cn(
                    "block text-xs",
                    proposal.tax.rate === undefined ? "text-amber-700" : "text-slate-400",
                  )}
                >
                  {source}
                </span>
              ) : null}
            </dt>
            <dd className="flex shrink-0 items-center gap-2">
              {editable ? (
                <Input
                  aria-label="Sales tax rate, percent"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  onBlur={commitRate}
                  className="w-20 bg-white text-right"
                />
              ) : (
                <span className="w-20 text-right tabular-nums text-slate-500">
                  {rate || "—"}
                </span>
              )}
              <span className="w-3 text-xs text-slate-400">%</span>
              <span className="w-24 text-right tabular-nums text-slate-900">
                {formatCents(proposal.money.taxCents)}
              </span>
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-6 border-t pt-2 font-semibold text-slate-900">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatCents(totalCents)}</dd>
        </div>
      </dl>
      {depositFault ? (
        <p role="alert" className="text-xs text-red-700">
          {depositFault}
        </p>
      ) : overTotal ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The deposit is more than the total of {formatCents(totalCents)} now. Lower it
          before sending.
        </p>
      ) : editable ? (
        <p className="text-xs text-slate-500">
          The paper prints these rows as they read here, leaving off a payment of $0.
        </p>
      ) : null}
    </div>
  );
}

// A payment's figure. One of $0 is struck through, because the paper leaves
// that row off; one past the total is marked as the fault it is.
function PaymentAmount({ cents, over = false }: { cents: number | null; over?: boolean }) {
  return (
    <span
      className={cn(
        "w-24 text-right tabular-nums text-slate-900",
        cents === 0 && "text-slate-400 line-through",
        over && "text-red-700",
      )}
    >
      {cents === null ? "—" : formatCents(cents)}
    </span>
  );
}

function RecommendedToggle({
  recommended,
  heldBy,
  onSet,
}: {
  recommended: boolean;
  heldBy: string | null;
  onSet: (recommended: boolean) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-2">
      <FieldHeading>Recommended</FieldHeading>
      {confirming ? (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p>
            {heldBy} is this site&rsquo;s Recommended proposal. Marking this one takes the
            mark off it.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setConfirming(false);
                void onSet(true);
              }}
            >
              Recommend this one
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep {heldBy}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant={recommended ? "default" : "outline"}
          aria-pressed={recommended}
          onClick={() => {
            if (!recommended && heldBy) {
              setConfirming(true);
              return;
            }
            void onSet(!recommended);
          }}
        >
          <Star data-icon="inline-start" aria-hidden />
          {recommended ? "Recommended" : "Mark as Recommended"}
        </Button>
      )}
      <p className="text-xs text-slate-500">
        At most one proposal per site carries the mark, to steer the customer toward
        the one you&rsquo;d choose.
      </p>
    </div>
  );
}
