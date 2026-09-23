"use client";

// PROTOTYPE — throwaway. Question: what should a solution's material allowance
// look like, in the owner's solution panel and on the proposal paper?
// Three variants of the panel, switchable via `?variant=A|B|C`, beside the real
// proposal paper drawn from the same in-memory solution. Nothing is saved.
//
// Settled before this was built: one optional allowance per solution, always
// called "Material allowance", whole dollars, no markup, added to the price as
// typed; what it covers is written in the scope of work; the paper prints it as
// the last row of the solution's table with its amount where a quantity would
// be; and a new Terms clause says what an allowance means.

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { PaperScreen } from "@/components/paper-screen";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { FieldHeading, FieldLabel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { proposalTerms } from "@/lib/expand-business";
import { LineItemUnits, lineItemUnitLabel, isLineItemUnit } from "@/lib/line-item-units";
import { formatCents } from "@/lib/money";
import type { PaperProposal } from "@/lib/proposal-paper";
import { proposalMoney } from "@/lib/proposal-pricing";
import { priceSolution, offeredLineItems, type SolutionPrice } from "@/lib/solution-pricing";
import {
  lineCostLabel,
  readLineItems,
  type LineItemDraft,
} from "@/lib/solutions";
import { cn } from "@/lib/utils";

const Variants = [
  { key: "A", name: "Own section" },
  { key: "B", name: "Row in the table" },
  { key: "C", name: "In the price summary" },
] as const;
type VariantKey = (typeof Variants)[number]["key"];

// ---------------------------------------------------------------------------
// In-memory state, shared by every variant so flipping keeps what was typed.

type Draft = {
  title: string;
  scope: string;
  lines: LineItemDraft[];
  markup: string;
  // Whole dollars as typed; null when the solution has no allowance.
  allowance: string | null;
};

const line = (key: string, name: string, quantity: string, unit: string, unitCost: string) =>
  ({ key, name, quantity, unit, unitCost, stored: true }) as LineItemDraft;

const StartingDraft: Draft = {
  title: "Kitchen Cabinet Restoration",
  scope: [
    "Restore and reinstall existing kitchen cabinetry.",
    "Treat accessible mold-affected cabinet surfaces using Concrobium Mold Control or comparable mold-control product, and allow treated areas to dry in accordance with product requirements.",
    "Preserve existing lacquer finish on cabinet doors and fronts where possible.",
    "Replace damaged/mold-affected white melamine cabinet panels as required.",
    "Reinstall lower kitchen cabinets; level, align, and secure cabinet boxes; adjust doors and drawers; reconnect cabinet sections.",
    "The material allowance covers replacement of up to approximately 70% of the existing white melamine cabinet panels. The exact amount of material required will be determined as damaged and mold-affected components are removed and evaluated.",
  ].join("\n"),
  lines: [
    line("l1", "Cabinet removal, restoration and reinstall", "56", "HR", "65.00"),
    line("l2", "Mold treatment and cleaning", "12", "HR", "65.00"),
    line("l3", "Concrobium Mold Control", "4", "EA", "30.00"),
    line("l4", "Fasteners, shims and adhesive", "1", "EA", "232.72"),
  ],
  markup: "10",
  allowance: "1300",
};

// A second solution with no allowance, so the paper shows the allowance is
// something a solution may have, not something every one does.
const FaucetSolution = {
  title: "Kitchen Faucet Replacement",
  scope: "Remove existing kitchen faucet and install customer-selected replacement.\nTest for leaks and clean up work area.",
  lines: [
    line("f1", "Faucet replacement labor", "2", "HR", "65.00"),
    line("f2", "Supply lines", "2", "EA", "14.50"),
  ],
};

function readAllowanceCents(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  const dollars = Number(cleaned);
  return Number.isInteger(dollars) && dollars >= 0 ? dollars * 100 : 0;
}

// The price rule this prototype proposes: line items at markup, rounded up to
// the dollar as today, plus the allowance exactly as typed. A solution with
// only an allowance is priced; one with neither has no price.
function priceWithAllowance(draft: Draft): {
  lines: SolutionPrice | null;
  allowanceCents: number | undefined;
  priceCents: number | null;
} {
  const markup = Number(draft.markup);
  const lines = priceSolution(
    readLineItems(draft.lines),
    Number.isInteger(markup) ? markup : 10,
  );
  const allowanceCents = readAllowanceCents(draft.allowance);
  if (lines === null && allowanceCents === undefined) {
    return { lines, allowanceCents, priceCents: null };
  }
  return {
    lines,
    allowanceCents,
    priceCents: (lines?.priceCents ?? 0) + (allowanceCents ?? 0),
  };
}

const AllowanceTerm = {
  heading: "Material allowance.",
  body: "Where a solution includes a material allowance, that amount is our estimate of what its materials will cost, and it is included in the price. If the materials cost less, we will credit the difference against your final payment. Before buying materials that would go over it, we will tell you the extra cost in writing and go ahead only once you approve it, as under Changes.",
};

function paperFor(draft: Draft): PaperProposal {
  const cabinets = priceWithAllowance(draft);
  const faucet = priceSolution(readLineItems(FaucetSolution.lines), 10);
  const tax = { source: "lookup" as const, rate: 0.087 };
  const money = proposalMoney(
    [
      cabinets.priceCents === null
        ? null
        : { costCents: 0, priceCents: cabinets.priceCents },
      faucet,
    ],
    tax,
  );
  const terms = proposalTerms();
  const at = terms.findIndex((term) => term.heading === "Materials and permits.");
  terms.splice(at + 1, 0, AllowanceTerm);

  return {
    proposalId: "prototype",
    number: 1,
    code: "4410NE94TH-P1",
    name: "Kitchen repairs",
    state: "draft",
    recommended: true,
    sentAt: Date.UTC(2026, 8, 23),
    estimator: { name: "Andrew Putilin", email: "andyputilin@gmail.com" },
    customerName: "Jane Customer",
    site: { street: "4410 NE 94th St", city: "Vancouver, WA 98665" },
    solutions: [
      {
        solutionId: "cabinets",
        title: draft.title,
        scopeOfWork: draft.scope,
        lineItems: offeredLineItems(readLineItems(draft.lines)),
        allowanceCents: cabinets.allowanceCents,
      },
      {
        solutionId: "faucet",
        title: FaucetSolution.title,
        scopeOfWork: FaucetSolution.scope,
        lineItems: offeredLineItems(readLineItems(FaucetSolution.lines)),
      },
    ],
    terms,
    tax,
    ...money,
    depositPercent: 50,
  };
}

// ---------------------------------------------------------------------------

export function MaterialAllowancePrototype() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("variant") ?? "A";
  const variant: VariantKey = Variants.some((v) => v.key === raw) ? (raw as VariantKey) : "A";
  const [draft, setDraft] = useState<Draft>(StartingDraft);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 xl:flex-row">
      <div className="w-full shrink-0 space-y-4 overflow-y-auto p-4 pb-24 xl:h-screen xl:w-[54rem]">
        <p className="rounded-lg bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900 ring-1 ring-fuchsia-200">
          <b>Prototype.</b> Nothing saves. Edit the solution on the left, and the proposal paper on
          the right updates. Flip variants with the pink bar or ← →.
        </p>
        <SolutionsListPreview draft={draft} />
        <PanelFrame title={draft.title}>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="t">Title</FieldLabel>
            <Input
              id="t"
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              className="w-full bg-white font-medium"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="s">Scope of work</FieldLabel>
            <Textarea
              id="s"
              value={draft.scope}
              onChange={(e) => set({ scope: e.target.value })}
              className="min-h-40 bg-white"
            />
          </div>
          {variant === "A" ? <VariantA draft={draft} set={set} /> : null}
          {variant === "B" ? <VariantB draft={draft} set={set} /> : null}
          {variant === "C" ? <VariantC draft={draft} set={set} /> : null}
        </PanelFrame>
      </div>
      <div className="min-w-0 flex-1 xl:h-screen xl:overflow-y-auto">
        <PaperScreen
          paper={paperFor(draft)}
          strip={{ tone: "note", body: "Prototype paper · Kitchen Cabinet Restoration updates live" }}
        />
      </div>
      <PrototypeSwitcher variants={Variants} current={variant} />
    </div>
  );
}

type VariantProps = { draft: Draft; set: (patch: Partial<Draft>) => void };

// ---------------------------------------------------------------------------
// A — Own section: the allowance is its own block under the line items, added
// with a button and gone with Remove. The price readout lists it on its own row.

function VariantA({ draft, set }: VariantProps) {
  const price = priceWithAllowance(draft);
  return (
    <>
      <LineItemsTable draft={draft} set={set} />
      <div className="space-y-2">
        <FieldHeading>Material allowance</FieldHeading>
        {draft.allowance === null ? (
          <button
            type="button"
            onClick={() => set({ allowance: "" })}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left text-sm text-slate-500 transition-colors hover:border-slate-400 hover:bg-white"
          >
            <Plus className="size-4 shrink-0" />
            <span>
              <span className="font-medium text-slate-700">Add a material allowance</span>
              <span className="block text-xs">
                For materials you can only estimate now. Settled to actual cost later.
              </span>
            </span>
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3">
            <DollarInput
              id="allowance-a"
              value={draft.allowance}
              onChange={(allowance) => set({ allowance })}
              className="w-36"
            />
            <p className="min-w-0 flex-1 text-xs text-slate-500">
              Added to the price as typed, with no markup. Say what it covers in the scope of
              work.
            </p>
            <Button variant="ghost" size="sm" onClick={() => set({ allowance: null })}>
              <X data-icon="inline-start" aria-hidden /> Remove
            </Button>
          </div>
        )}
      </div>
      <PriceSummary draft={draft} set={set} price={price} allowanceRow="readonly" />
    </>
  );
}

// ---------------------------------------------------------------------------
// B — Row in the table: the allowance sits as a pinned, tinted last row of the
// line item table, the way the paper prints it. "Add material allowance" sits
// beside "Add line" until there is one.

function VariantB({ draft, set }: VariantProps) {
  const price = priceWithAllowance(draft);
  return (
    <>
      <LineItemsTable
        draft={draft}
        set={set}
        pinned={
          draft.allowance === null ? null : (
            <li
              className={cn(
                LineGrid,
                "border-t border-amber-200 bg-amber-50/70 px-3 py-2",
              )}
            >
              <div className="col-span-3 flex items-center gap-2 sm:col-span-1">
                <span className="text-sm font-medium text-slate-900">Material allowance</span>
                <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-900 uppercase">
                  No markup
                </span>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <DollarInput
                  id="allowance-b"
                  value={draft.allowance}
                  onChange={(allowance) => set({ allowance })}
                  className="w-full sm:ml-auto sm:w-40"
                />
              </div>
              <p className="self-center text-sm tabular-nums text-slate-900 sm:text-right">
                {formatCents(readAllowanceCents(draft.allowance) ?? 0)}
              </p>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove material allowance"
                  onClick={() => set({ allowance: null })}
                >
                  <X aria-hidden />
                </Button>
              </div>
            </li>
          )
        }
        extraAction={
          draft.allowance === null ? (
            <Button variant="outline" onClick={() => set({ allowance: "" })}>
              <Plus data-icon="inline-start" aria-hidden /> Add material allowance
            </Button>
          ) : null
        }
      />
      <PriceSummary draft={draft} set={set} price={price} allowanceRow="readonly" />
    </>
  );
}

// ---------------------------------------------------------------------------
// C — In the price summary: no new block at all. The allowance is one more
// field in the readout under the table, beside Markup; blank means none.

function VariantC({ draft, set }: VariantProps) {
  const price = priceWithAllowance(draft);
  return (
    <>
      <LineItemsTable draft={draft} set={set} />
      <PriceSummary draft={draft} set={set} price={price} allowanceRow="field" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared furniture, drawn to match components/customer-solutions.tsx.

const LineGrid =
  "grid grid-cols-3 gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_7rem_6.5rem_5.5rem_auto] sm:items-center";

function LineItemsTable({
  draft,
  set,
  pinned,
  extraAction,
}: VariantProps & { pinned?: ReactNode; extraAction?: ReactNode }) {
  const edit = (index: number, patch: Partial<LineItemDraft>) =>
    set({ lines: draft.lines.map((row, at) => (at === index ? { ...row, ...patch } : row)) });
  const move = (index: number, to: number) => {
    const lines = [...draft.lines];
    const [row] = lines.splice(index, 1);
    lines.splice(to, 0, row);
    set({ lines });
  };

  return (
    <div className="space-y-2">
      <FieldHeading>Line items</FieldHeading>
      <div className="overflow-hidden rounded-xl border bg-white">
        <div
          aria-hidden
          className={cn(
            LineGrid,
            "hidden bg-slate-50 px-3 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase sm:grid",
          )}
        >
          <span>Name</span>
          <span className="text-right">Qty</span>
          <span>Unit</span>
          <span className="text-right">Unit cost</span>
          <span className="text-right">Cost</span>
          <span />
        </div>
        <ul>
          {draft.lines.length === 0 && !pinned ? (
            <p className="px-3 py-4 text-sm text-slate-500">No line items yet.</p>
          ) : null}
          {draft.lines.map((row, index) => {
            const read = readLineItems([row])[0];
            return (
              <li key={row.key} className={cn(LineGrid, "border-t px-3 py-2 first:border-t-0 sm:first:border-t")}>
                <Input
                  aria-label="Line item name"
                  value={row.name}
                  onChange={(e) => edit(index, { name: e.target.value })}
                  className="col-span-3 w-full bg-white sm:col-span-1"
                />
                <Input
                  aria-label="Quantity"
                  value={row.quantity}
                  onChange={(e) => edit(index, { quantity: e.target.value })}
                  className="w-full bg-white text-right"
                />
                <select
                  aria-label="Unit"
                  value={row.unit}
                  onChange={(e) => {
                    if (isLineItemUnit(e.target.value)) edit(index, { unit: e.target.value });
                  }}
                  className="h-8 w-full rounded-lg border border-input bg-white px-2 text-sm"
                >
                  {LineItemUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit} — {lineItemUnitLabel(unit)}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Unit cost"
                  value={row.unitCost}
                  onChange={(e) => edit(index, { unitCost: e.target.value })}
                  className="w-full bg-white text-right"
                />
                <p className="col-span-2 self-center text-sm tabular-nums sm:col-span-1 sm:text-right">
                  {read === undefined ? "—" : lineCostLabel(read)}
                </p>
                <div className="flex justify-end">
                  <Button variant="ghost" size="icon-sm" aria-label="Up" disabled={index === 0} onClick={() => move(index, index - 1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Down"
                    disabled={index === draft.lines.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove line"
                    onClick={() => set({ lines: draft.lines.filter((_, at) => at !== index) })}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
          {pinned}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            set({
              lines: [
                ...draft.lines,
                line(`n${Date.now()}`, "", "1", "EA", ""),
              ],
            })
          }
        >
          <Plus data-icon="inline-start" aria-hidden /> Add line
        </Button>
        {extraAction}
      </div>
    </div>
  );
}

function PriceSummary({
  draft,
  set,
  price,
  allowanceRow,
}: VariantProps & {
  price: ReturnType<typeof priceWithAllowance>;
  allowanceRow: "readonly" | "field";
}) {
  return (
    <div className="flex justify-end">
      <dl className="w-full space-y-1 text-sm sm:w-auto sm:min-w-72">
        {price.lines ? <Row label="Cost" value={formatCents(price.lines.costCents)} /> : null}
        <div className="flex items-center justify-between gap-6 text-slate-500">
          <dt className="flex items-center gap-1.5">
            <label htmlFor="markup">Markup</label>
            <Input
              id="markup"
              value={draft.markup}
              onChange={(e) => set({ markup: e.target.value })}
              className="w-14 bg-white px-2 text-right text-slate-900"
            />
            <span aria-hidden>%</span>
          </dt>
          <dd className="tabular-nums">
            {price.lines ? formatCents(price.lines.priceCents - price.lines.costCents) : "—"}
          </dd>
        </div>
        {allowanceRow === "field" ? (
          <div className="flex items-center justify-between gap-6 text-slate-500">
            <dt>
              <label htmlFor="allowance-c">Material allowance</label>
              <span className="block text-[11px] text-slate-400">No markup · blank for none</span>
            </dt>
            <dd>
              <DollarInput
                id="allowance-c"
                value={draft.allowance ?? ""}
                onChange={(allowance) => set({ allowance: allowance.trim() === "" ? null : allowance })}
                className="w-28"
              />
            </dd>
          </div>
        ) : price.allowanceCents !== undefined ? (
          <Row label="Material allowance" value={formatCents(price.allowanceCents)} />
        ) : null}
        {price.priceCents === null ? (
          <div className="text-amber-700">No price</div>
        ) : (
          <div className="flex justify-between gap-6 border-t pt-1 font-semibold text-slate-900">
            <dt>Price</dt>
            <dd className="tabular-nums">{formatCents(price.priceCents)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 text-slate-500">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function DollarInput({
  id,
  value,
  onChange,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-slate-400">
        $
      </span>
      <Input
        id={id}
        inputMode="numeric"
        placeholder="0"
        aria-label="Material allowance, whole dollars"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white pl-6 text-right tabular-nums"
      />
    </div>
  );
}

// The panel's chrome, drawn flat on the page rather than as a sliding sheet so
// it can sit beside the paper.
function PanelFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="border-b px-6 py-5">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <SiteChip />
      </header>
      <div className="space-y-6 bg-slate-50/40 px-6 py-5">{children}</div>
    </section>
  );
}

function SiteChip() {
  return (
    <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
      441094TH
    </span>
  );
}

// The Solutions tab's rows, so the list's summary line can be judged too.
function SolutionsListPreview({ draft }: { draft: Draft }) {
  const cabinets = priceWithAllowance(draft);
  const faucet = priceSolution(readLineItems(FaucetSolution.lines), 10);
  const lines = readLineItems(draft.lines).length;
  const rows = [
    {
      title: draft.title,
      detail: [
        lines === 1 ? "1 line item" : `${lines} line items`,
        cabinets.allowanceCents !== undefined
          ? `${formatCents(cabinets.allowanceCents)} material allowance`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      price: cabinets.priceCents,
    },
    { title: FaucetSolution.title, detail: "2 line items", price: faucet?.priceCents ?? null },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="border-b px-5 py-3 text-sm font-semibold text-slate-900">Solutions</div>
      <ol>
        {rows.map((row) => (
          <li key={row.title} className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-900">{row.title}</span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <SiteChip />
                <span aria-hidden>·</span>
                <span className="truncate">{row.detail}</span>
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {row.price === null ? "No price" : formatCents(row.price)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
