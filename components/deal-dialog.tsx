"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { Check, Search } from "lucide-react";
import { useState } from "react";

import { CustomerFields, blankCustomer } from "@/components/customer-fields";
import { SourceBadge } from "@/components/deal-chips";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCustomers } from "@/hooks/use-customers";
import {
  contactWarnings,
  customerErrors,
  dealCustomerSchema,
  type CustomerErrors,
  type CustomerInput,
} from "@/lib/customer";
import {
  HAND_SOURCES,
  MAX_NOTES,
  MAX_TITLE,
  readBallpark,
  titleFault,
  type HandSource,
} from "@/lib/pipeline";
import { cn, errorMessage } from "@/lib/utils";

type Who = "existing" | "new";

// The New deal dialog: a **Deal** the owner is chasing that did not come
// from Thumbtack, for a customer already on file (and one of their sites, if
// it is known) or for a new one made here from a name and whatever else they
// have. It lands in New, and the page opens its panel.
export function DealDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (dealId: Id<"deals">) => void;
}) {
  const create = useMutation(api.deals.create);
  const customers = useCustomers();
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState<Who>("existing");
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState<Id<"customers"> | null>(null);
  const [siteId, setSiteId] = useState<Id<"sites"> | null>(null);
  const [customer, setCustomer] = useState<CustomerInput>(blankCustomer);
  const [title, setTitle] = useState("");
  const [ballpark, setBallpark] = useState("");
  const [source, setSource] = useState<HandSource>("phone");
  const [note, setNote] = useState("");
  const [faults, setFaults] = useState<CustomerErrors & { pick?: string; title?: string; ballpark?: string }>({});
  const [error, setError] = useState("");

  const needle = search.trim().toLowerCase();
  const matches = (customers ?? [])
    .filter((c) => c.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
  // The picked customer stays in view whatever the search says since, so the
  // deal is never added for someone the owner cannot see is picked.
  const chosen = customers?.find((c) => c._id === customerId);
  const shown =
    chosen && !matches.includes(chosen) ? [chosen, ...matches.slice(0, 5)] : matches;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {/* Taller than a phone's screen, so it scrolls inside itself. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>A job you are chasing. It starts in New.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const next: typeof faults = {};
            let whose: FunctionArgs<typeof api.deals.create>["customer"] | null = null;
            if (who === "existing") {
              if (customerId) whose = { customerId };
              else next.pick = "Pick a customer, or add a new one.";
            } else {
              const parsed = dealCustomerSchema.safeParse(customer);
              if (parsed.success) whose = parsed.data;
              else Object.assign(next, customerErrors(parsed.error));
            }
            const titleProblem = titleFault(title);
            if (titleProblem) next.title = titleProblem;
            const read = readBallpark(ballpark);
            if ("fault" in read) next.ballpark = read.fault;
            setFaults(next);
            if (Object.keys(next).length || "fault" in read || !whose) return;

            setBusy(true);
            try {
              const dealId = await create({
                customer: whose,
                title,
                source,
                ...(who === "existing" && siteId ? { siteId } : {}),
                ...(read.cents !== null ? { ballparkCents: read.cents } : {}),
                ...(note.trim() ? { notes: note } : {}),
              });
              onCreated(dealId);
              onClose();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          <Field data-invalid={Boolean(faults.pick) || undefined}>
            <FieldLabel>Customer</FieldLabel>
            <Segmented<Who>
              label="Customer"
              value={who}
              onChange={(value) => {
                setWho(value);
                setFaults({});
              }}
              options={[
                { value: "existing", label: "Existing" },
                { value: "new", label: "New customer" },
              ]}
            />
            {who === "existing" ? (
              <>
                <label className="relative block">
                  <span className="sr-only">Search customers</span>
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={search}
                    disabled={busy}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={customers === undefined ? "Loading customers…" : "Search customers"}
                    className="pl-8"
                  />
                </label>
                <ul className="max-h-44 divide-y overflow-y-auto rounded-lg border">
                  {customers !== undefined && shown.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-500">
                      No customer matches. Try New customer.
                    </li>
                  ) : (
                    shown.map((c) => {
                      const picked = customerId === c._id;
                      return (
                        <li key={c._id}>
                          <button
                            type="button"
                            disabled={busy}
                            aria-pressed={picked}
                            onClick={() => {
                              setCustomerId(c._id);
                              setSiteId(null);
                              setFaults((held) => ({ ...held, pick: undefined }));
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                              picked && "bg-slate-900 text-white hover:bg-slate-900",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            <span className={cn("text-xs", picked ? "text-white/70" : "text-slate-500")}>
                              {c.siteCount === 1 ? "1 site" : `${c.siteCount} sites`}
                            </span>
                            {picked ? <Check aria-hidden className="size-4" /> : null}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
                <FieldError>{faults.pick}</FieldError>
              </>
            ) : null}
          </Field>

          {who === "new" ? (
            <CustomerFields
              value={customer}
              onChange={setCustomer}
              errors={faults}
              warnings={contactWarnings(customer, customers ?? [])}
              disabled={busy}
            />
          ) : customerId ? (
            <SiteChoice customerId={customerId} value={siteId} onChange={setSiteId} disabled={busy} />
          ) : null}

          <Field data-invalid={Boolean(faults.title) || undefined}>
            <FieldLabel htmlFor="deal-title">What&apos;s the job?</FieldLabel>
            <Input
              id="deal-title"
              value={title}
              maxLength={MAX_TITLE}
              disabled={busy}
              aria-invalid={Boolean(faults.title)}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Deck board replacement"
            />
            <FieldError>{faults.title}</FieldError>
          </Field>

          <Field data-invalid={Boolean(faults.ballpark) || undefined}>
            <FieldLabel htmlFor="deal-ballpark">Ballpark (optional)</FieldLabel>
            <Input
              id="deal-ballpark"
              value={ballpark}
              inputMode="numeric"
              disabled={busy}
              aria-invalid={Boolean(faults.ballpark)}
              onChange={(event) => setBallpark(event.target.value)}
              placeholder="$"
              className="sm:w-40"
            />
            <FieldError>{faults.ballpark}</FieldError>
          </Field>

          <Field>
            <FieldLabel>Where did it come from?</FieldLabel>
            <div role="radiogroup" aria-label="Where did it come from?" className="flex flex-wrap gap-1.5">
              {HAND_SOURCES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={source === option}
                  disabled={busy}
                  onClick={() => setSource(option)}
                  className={cn(
                    "rounded-lg border px-1.5 py-1 transition",
                    source === option ? "border-slate-900 bg-slate-50" : "border-transparent hover:bg-slate-50",
                  )}
                >
                  <SourceBadge source={option} />
                </button>
              ))}
            </div>
            <FieldDescription>Thumbtack deals arrive on their own.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="deal-note">First note (optional)</FieldLabel>
            <Textarea
              id="deal-note"
              value={note}
              maxLength={MAX_NOTES}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What they said on the phone."
              className="min-h-16"
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add deal"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// One of the picked customer's sites, or none yet: a deal can start before
// anyone knows where the work is.
function SiteChoice({
  customerId,
  value,
  onChange,
  disabled,
}: {
  customerId: Id<"customers">;
  value: Id<"sites"> | null;
  onChange: (siteId: Id<"sites"> | null) => void;
  disabled: boolean;
}) {
  const sites = useQuery(api.sites.forCustomer, { customerId });
  if (!sites?.length) return null;
  const options = [
    { siteId: null, label: "Not yet", detail: "" },
    ...sites.map((site) => ({ siteId: site._id, label: site.streetLine, detail: site.cityLine })),
  ];
  return (
    <Field>
      <FieldLabel>Site (optional)</FieldLabel>
      <ul className="max-h-44 divide-y overflow-y-auto rounded-lg border">
        {options.map((option) => {
          const picked = value === option.siteId;
          return (
            <li key={option.siteId ?? "none"}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={picked}
                onClick={() => onChange(option.siteId)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                  picked && "bg-slate-900 text-white hover:bg-slate-900",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.detail ? (
                  <span className={cn("truncate text-xs", picked ? "text-white/70" : "text-slate-500")}>
                    {option.detail}
                  </span>
                ) : null}
                {picked ? <Check aria-hidden className="size-4" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Field>
  );
}
