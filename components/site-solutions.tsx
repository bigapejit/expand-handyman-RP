"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { HubEmpty, HubLoading, HubSection } from "@/components/hub-section";
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
import {
  isLineItemUnit,
  LineItemUnits,
  lineItemUnitLabel,
  type LineItemUnit,
} from "@/lib/line-item-units";
import { formatCents } from "@/lib/money";
import {
  blankLineItemDraft,
  draftPrice,
  draftsFromLineItems,
  lineCostLabel,
  lineItemsToStore,
  markupField,
  markupToStore,
  materialAllowanceField,
  materialAllowanceToStore,
  moveDraft,
  priceReadout,
  readLineItems,
  readMarkupField,
  readMaterialAllowanceField,
  sameLineItems,
  solutionDetailLabel,
  solutionPriceLabel,
  unitCostField,
  type LineItemDraft,
} from "@/lib/solutions";
import { cn, errorMessage } from "@/lib/utils";

type Solution = FunctionReturnType<typeof api.solutions.forSite>[number];
type CatalogSuggestion = FunctionReturnType<typeof api.catalog.suggestions>[number];
type SolutionPatch = Omit<FunctionArgs<typeof api.solutions.update>, "solutionId">;

// The Solutions tab, ported from FRSG's site-solutions.tsx: one site's
// solutions on the site page. Opening a row slides the panel in over the list
// and puts the solution in the URL, so a reload or a copied link reopens it.
// Every edit lands as the field is left; nothing here is customer-visible
// until a proposal is sent.
export function SiteSolutions({ siteId }: { siteId: Id<"sites"> }) {
  const solutions = useQuery(api.solutions.forSite, { siteId });
  const create = useMutation(api.solutions.create);
  const { openId, open, close } = useSidePanel("solution");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  // A link naming a solution since deleted just shows the list.
  const openSolution = solutions?.find((solution) => solution._id === openId);

  const add = async () => {
    setAdding(true);
    setError("");
    try {
      open(await create({ siteId }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <HubSection
      title="Solutions"
      description={
        solutions?.length
          ? `${solutions.length === 1 ? "1 solution" : `${solutions.length} solutions`}: the priced pieces of work proposals are assembled from.`
          : "The priced pieces of work proposals are assembled from."
      }
      action={
        <Button variant="outline" size="lg" disabled={adding} onClick={() => void add()}>
          <Plus data-icon="inline-start" aria-hidden /> New solution
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="border-b px-5 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {solutions === undefined ? (
        <HubLoading label="Loading solutions" />
      ) : solutions.length === 0 ? (
        <HubEmpty>No solutions yet. Price one for each piece of work this site needs.</HubEmpty>
      ) : (
        <ol>
          {solutions.map((solution) => (
            <SolutionRow
              key={solution._id}
              solution={solution}
              open={() => open(solution._id)}
            />
          ))}
        </ol>
      )}
      {openSolution ? (
        <SolutionPanel key={openSolution._id} solution={openSolution} onClose={close} />
      ) : null}
    </HubSection>
  );
}

// Every row is at the same site, so none repeats the site's name.
function SolutionRow({ solution, open }: { solution: Solution; open: () => void }) {
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-900">{solution.title}</span>
          <span className="block truncate text-xs text-slate-500">
            {solutionDetailLabel(solution.lineItems.length, solution.materialAllowanceCents)}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 text-sm tabular-nums",
            solution.price === null ? "text-amber-700" : "font-semibold text-slate-900",
          )}
        >
          {solutionPriceLabel(solution.price)}
        </span>
      </button>
    </li>
  );
}

// The whole solution, open for writing. Text commits when the field is left,
// so a half-typed title never becomes the solution.
function SolutionPanel({ solution, onClose }: { solution: Solution; onClose: () => void }) {
  const update = useMutation(api.solutions.update);
  const remove = useMutation(api.solutions.remove);
  const [title, setTitle] = useState(solution.title);
  const [description, setDescription] = useState(solution.description);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // A refusal belongs where the edit was made: the tab's own error line is
  // behind the panel.
  const [refusal, setRefusal] = useState("");

  const save = async (patch: SolutionPatch): Promise<boolean> => {
    try {
      await update({ solutionId: solution._id, ...patch });
      setRefusal("");
      return true;
    } catch (err) {
      setRefusal(errorMessage(err));
      return false;
    }
  };

  const commitTitle = () => {
    // A solution the customer reads needs a name, so an emptied field snaps
    // back to what it is still called.
    if (!title.trim()) {
      setTitle(solution.title);
      return;
    }
    if (title.trim() !== solution.title) void save({ title });
  };

  return (
    <SidePanel
      title={solution.title}
      description={<SiteTag name={solution.siteName} />}
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        {refusal ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {refusal}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <FieldLabel htmlFor="solution-title">Title</FieldLabel>
          <Input
            id="solution-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            className="w-full bg-white font-medium"
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="solution-scope">Scope of work</FieldLabel>
          <Textarea
            id="solution-scope"
            value={description}
            placeholder="Describe the work the customer will read…"
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description.trim() !== solution.description) void save({ description });
            }}
            className="min-h-24 bg-white"
          />
        </div>

        <LineItemTable solution={solution} onSave={save} />

        <div className="flex items-center justify-end gap-3 border-t pt-4">
          {solution.deletable ? null : (
            <p className="flex-1 text-xs text-slate-500">
              A sent or decided proposal includes this solution, so it can&rsquo;t be
              deleted.
            </p>
          )}
          <Button
            variant="destructive"
            size="lg"
            disabled={!solution.deletable}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 data-icon="inline-start" aria-hidden /> Delete
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {solution.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its line items go with it, and any draft proposal offering it drops it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep solution</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirmingDelete(false);
                try {
                  await remove({ solutionId: solution._id });
                  onClose();
                } catch (err) {
                  setRefusal(errorMessage(err));
                }
              }}
            >
              Delete solution
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidePanel>
  );
}

// The cost buildup: every kind of cost as an ordinary line, the markup the
// solution is sold at, any material allowance pinned under the lines, and the
// price they add up to. The table is written locally and stored whole on every
// commit — a line item has no identity of its own — and the readout under it
// recomputes on every keystroke from the same module the server prices with.
function LineItemTable({
  solution,
  onSave,
}: {
  solution: Solution;
  onSave: (patch: SolutionPatch) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<LineItemDraft[]>(() =>
    draftsFromLineItems(solution.lineItems),
  );
  // A string for the same reason a quantity is: "1" on the way to "15" is a
  // real state of the field.
  const [markup, setMarkup] = useState(() => markupField(solution.markupPercent));
  // The allowance field as typed, or null while the solution has none and its
  // row is not shown.
  const storedAllowance = solution.materialAllowanceCents;
  const [allowance, setAllowance] = useState<string | null>(() =>
    storedAllowance === null ? null : materialAllowanceField(storedAllowance),
  );
  const nextKey = useRef(0);

  // Stored only when the table says something different and whole. A refusal
  // puts the table back to the lines the solution still holds; a save marks
  // every named row stored, so emptying one later waits as a retyped name
  // rather than deleting the line.
  const commit = async (rows: LineItemDraft[]) => {
    const lineItems = lineItemsToStore(rows);
    if (lineItems === null) return;
    if (sameLineItems(lineItems, solution.lineItems)) return;
    if (await onSave({ lineItems }))
      setDrafts((current) =>
        current.map((row) => (row.name.trim() ? { ...row, stored: true } : row)),
      );
    else setDrafts(draftsFromLineItems(solution.lineItems));
  };

  const editRow = (index: number, patch: Partial<LineItemDraft>) => {
    setDrafts((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };

  // A pick, a removal or a move is the whole edit, so it stores at once.
  const replace = (next: LineItemDraft[]) => {
    setDrafts(next);
    void commit(next);
  };

  const addRow = () => {
    nextKey.current += 1;
    setDrafts((rows) => [...rows, blankLineItemDraft(`new-${nextKey.current}`)]);
  };

  // Stored when the field says a different whole percent, and snapped back
  // otherwise, a refusal included.
  const commitMarkup = async () => {
    const typed = markupToStore(markup, solution.markupPercent);
    if (typed === null || !(await onSave({ markupPercent: typed }))) {
      setMarkup(markupField(solution.markupPercent));
      return;
    }
    setMarkup(markupField(typed));
  };

  // What the field goes back to after a refusal: the stored amount, or an empty
  // row to try again in when there was none.
  const storedAllowanceField =
    storedAllowance === null ? "" : materialAllowanceField(storedAllowance);

  // Leaving the field saves what it says, and emptied it takes the allowance
  // off as the ✕ does. A save that lands after the ✕ has already taken the row
  // away leaves it away.
  const commitAllowance = async (typed: string) => {
    const next = materialAllowanceToStore(typed, storedAllowance);
    if (next === undefined) {
      setAllowance(typed.trim() === "" ? null : storedAllowanceField);
      return;
    }
    if (!(await onSave({ materialAllowanceCents: next }))) {
      setAllowance((current) => (current === null ? null : storedAllowanceField));
      return;
    }
    setAllowance((current) =>
      current === null || next === null ? null : materialAllowanceField(next),
    );
  };

  // Cleared on the server even when this render has nothing stored: pressing
  // the ✕ blurs the field first, and the amount that blur is still saving must
  // not land after the row has gone. Mutations from one client run in order,
  // so this one always lands last.
  const removeAllowance = async () => {
    setAllowance(null);
    if (!(await onSave({ materialAllowanceCents: null })))
      setAllowance(storedAllowance === null ? null : storedAllowanceField);
  };

  const markupPercent = readMarkupField(markup) ?? solution.markupPercent;
  const allowanceCents = allowance === null ? undefined : readMaterialAllowanceField(allowance);
  const readout = priceReadout(draftPrice(drafts, markupPercent, allowanceCents));
  // A solution priced on its allowance alone has no cost or markup to read
  // out, rather than a cost and a markup of $0.
  const linesReadout = readLineItems(drafts).length > 0 ? readout : null;

  return (
    <div className="space-y-2">
      <FieldHeading>Line items</FieldHeading>

      <div className="overflow-hidden rounded-xl border">
        {/* A table's columns on a wide panel; on a phone each line stacks, so
            nothing is cut off at full width. */}
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
        {drafts.length === 0 && allowance === null ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            No line items yet, so this solution has no price. Every kind of cost is a
            line: materials, labor, permits, disposal.
          </p>
        ) : (
          <ul>
            {drafts.map((row, index) => (
              <LineItemRow
                key={row.key}
                row={row}
                isFirst={index === 0}
                isLast={index === drafts.length - 1}
                onEdit={(patch) => editRow(index, patch)}
                onCommit={() => void commit(drafts)}
                onPickUnit={(unit) =>
                  replace(drafts.map((r, at) => (at === index ? { ...r, unit } : r)))
                }
                onMove={(direction) => replace(moveDraft(drafts, index, direction))}
                onRemove={() => replace(drafts.filter((_, at) => at !== index))}
              />
            ))}
            {allowance === null ? null : (
              <MaterialAllowanceRow
                value={allowance}
                cents={allowanceCents}
                onChange={setAllowance}
                onCommit={() => void commitAllowance(allowance)}
                onRemove={() => void removeAllowance()}
              />
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={addRow}>
            <Plus data-icon="inline-start" aria-hidden /> Add line
          </Button>
          {allowance === null ? (
            <Button variant="outline" onClick={() => setAllowance("")}>
              <Plus data-icon="inline-start" aria-hidden /> Add material allowance
            </Button>
          ) : null}
        </div>

        {/* Internal for good: the customer reads the price and never the cost
            or the markup. */}
        <dl className="w-full space-y-1 text-sm sm:w-auto sm:min-w-64">
          {linesReadout === null ? null : (
            <Readout label="Cost" value={linesReadout.costLabel} />
          )}
          <div className="flex items-center justify-between gap-6 text-slate-500">
            <dt className="flex items-center gap-1.5">
              <label htmlFor="solution-markup">Markup</label>
              <Input
                id="solution-markup"
                inputMode="numeric"
                value={markup}
                onChange={(event) => setMarkup(event.target.value)}
                onBlur={() => void commitMarkup()}
                className="w-14 bg-white px-2 text-right text-slate-900"
              />
              <span aria-hidden>%</span>
            </dt>
            <dd className="tabular-nums">
              {linesReadout === null ? "—" : linesReadout.markupAmountLabel}
            </dd>
          </div>
          {readout?.materialAllowanceLabel ? (
            <Readout label="Material allowance" value={readout.materialAllowanceLabel} />
          ) : null}
          {readout === null ? (
            <div className="text-amber-700">No price</div>
          ) : (
            <div className="flex justify-between gap-6 border-t pt-1 font-semibold text-slate-900">
              <dt>Price</dt>
              <dd className="tabular-nums">{readout.priceLabel}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

const LineGrid =
  "grid grid-cols-3 gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_7rem_6.5rem_5.5rem_auto] sm:items-center";

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 text-slate-500">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function LineItemRow({
  row,
  isFirst,
  isLast,
  onEdit,
  onCommit,
  onPickUnit,
  onMove,
  onRemove,
}: {
  row: LineItemDraft;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (patch: Partial<LineItemDraft>) => void;
  onCommit: () => void;
  onPickUnit: (unit: LineItemUnit) => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const line = readLineItems([row])[0];

  return (
    <li className={cn(LineGrid, "border-t px-3 py-2 first:border-t-0 sm:first:border-t")}>
      <div className="col-span-3 sm:col-span-1">
        <LineItemNameField
          value={row.name}
          onChange={(name) => onEdit({ name })}
          onCommit={onCommit}
          onTake={(suggestion) =>
            // A suggestion taken is an ordinary line item from that moment on,
            // with no tie back to the Catalog.
            onEdit({
              name: suggestion.name,
              unit: suggestion.lastUnit,
              unitCost: unitCostField(suggestion.lastUnitCostCents),
            })
          }
        />
      </div>
      <MobileLabel label="Qty">
        <Input
          aria-label="Quantity"
          inputMode="decimal"
          value={row.quantity}
          onChange={(event) => onEdit({ quantity: event.target.value })}
          onBlur={onCommit}
          className="w-full bg-white text-right"
        />
      </MobileLabel>
      <MobileLabel label="Unit">
        <select
          aria-label="Unit"
          value={row.unit}
          onChange={(event) => {
            if (isLineItemUnit(event.target.value)) onPickUnit(event.target.value);
          }}
          className="h-8 w-full rounded-lg border border-input bg-white px-2 text-sm text-slate-900"
        >
          {LineItemUnits.map((unit) => (
            <option key={unit} value={unit}>
              {unit} — {lineItemUnitLabel(unit)}
            </option>
          ))}
        </select>
      </MobileLabel>
      <MobileLabel label="Unit cost">
        <Input
          aria-label="Unit cost"
          inputMode="decimal"
          placeholder="0.00"
          value={row.unitCost}
          onChange={(event) => onEdit({ unitCost: event.target.value })}
          onBlur={onCommit}
          className="w-full bg-white text-right"
        />
      </MobileLabel>
      <p className="col-span-2 self-center text-sm tabular-nums text-slate-900 sm:col-span-1 sm:text-right">
        <span className="text-slate-500 sm:hidden">Cost </span>
        {line === undefined ? "—" : lineCostLabel(line)}
      </p>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move line up"
          disabled={isFirst}
          onClick={() => onMove("up")}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move line down"
          disabled={isLast}
          onClick={() => onMove("down")}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Remove line" onClick={onRemove}>
          <X aria-hidden />
        </Button>
      </div>
    </li>
  );
}

// The material allowance, pinned under the line items and tinted apart from
// them: it has no name, quantity or unit, is never marked up and cannot be
// moved among the lines. A row freshly added opens with the cursor in it.
function MaterialAllowanceRow({
  value,
  cents,
  onChange,
  onCommit,
  onRemove,
}: {
  value: string;
  cents: number | undefined;
  onChange: (value: string) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        LineGrid,
        "border-t border-amber-200 bg-amber-50/70 px-3 py-2 first:border-t-0 sm:first:border-t",
      )}
    >
      <div className="col-span-3 flex items-center gap-2 sm:col-span-1">
        <span className="text-sm font-medium text-slate-900">Material allowance</span>
        <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-900 uppercase">
          No markup
        </span>
      </div>
      <div className="relative col-span-2 sm:col-span-3 sm:ml-auto sm:w-40">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-slate-400"
        >
          $
        </span>
        <Input
          aria-label="Material allowance, whole dollars"
          inputMode="numeric"
          placeholder="0"
          autoFocus={value === ""}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          className="w-full bg-white pl-6 text-right tabular-nums"
        />
      </div>
      <p className="self-center text-sm tabular-nums text-slate-900 sm:text-right">
        {cents === undefined ? "—" : formatCents(cents)}
      </p>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Remove material allowance"
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </div>
    </li>
  );
}

// A column heading over one field on a phone, where the table's header row is
// hidden.
function MobileLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1 sm:space-y-0">
      <span aria-hidden className="block text-xs text-slate-500 sm:hidden">
        {label}
      </span>
      {children}
    </div>
  );
}

// The name field, with names used before offered under it. The Catalog is
// asked only while the field has the cursor and only about what has been typed.
// Focus stays in the field: the arrow keys move through the suggestions, Enter
// takes one and Escape puts the list away, as a combobox does.
function LineItemNameField({
  value,
  onChange,
  onCommit,
  onTake,
}: {
  value: string;
  onChange: (name: string) => void;
  onCommit: () => void;
  onTake: (suggestion: CatalogSuggestion) => void;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const prefix = value.trim();
  const matches = useQuery(
    api.catalog.suggestions,
    focused && prefix.length > 0 ? { prefix } : "skip",
  );
  // A suggestion identical to what is already typed offers nothing.
  const offered = (matches ?? []).filter(
    (match) => match.name.toLowerCase() !== prefix.toLowerCase(),
  );
  const open = focused && !dismissed && offered.length > 0;
  const highlighted = open && active < offered.length ? active : -1;

  const take = (suggestion: CatalogSuggestion) => {
    onTake(suggestion);
    setDismissed(true);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const last = offered.length - 1;
      setActive(
        event.key === "ArrowDown"
          ? highlighted >= last ? 0 : highlighted + 1
          : highlighted <= 0 ? last : highlighted - 1,
      );
    } else if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      take(offered[highlighted]);
    } else if (event.key === "Escape") {
      // Closes the list, not the panel around it.
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <div className="relative">
      <Input
        aria-label="Line item name"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        value={value}
        placeholder="What this line is"
        onChange={(event) => {
          onChange(event.target.value);
          setDismissed(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setActive(-1);
          onCommit();
        }}
        className="w-full bg-white"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Line items used before"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg"
        >
          {offered.map((match, index) => (
            <li
              key={match.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              // Taken on mouse-down, because the blur that closes this list
              // would otherwise land first.
              onMouseDown={(event) => {
                event.preventDefault();
                take(match);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-1.5 text-sm",
                index === highlighted && "bg-slate-100",
              )}
            >
              <span className="truncate">{match.name}</span>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                {unitCostField(match.lastUnitCostCents) || "—"} / {match.lastUnit}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
