"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Plus, Search, Trash2, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AddressCombobox, PICK_ADDRESS, newLookupSession } from "@/components/address-combobox";
import { CustomerFields, blankCustomer } from "@/components/customer-fields";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCustomers } from "@/hooks/use-customers";
import {
  contactWarnings,
  customerErrors,
  customerSchema,
  displayPhone,
  findCustomers,
  formatPhone,
  type CustomerErrors,
  type CustomerInput,
} from "@/lib/customer";
import type { PlaceSuggestion } from "@/lib/places";
import {
  MAX_ACCESS_NOTES,
  MAX_UNIT,
  sameUnit,
  siteDeleteRefusal,
  siteStreetLine,
} from "@/lib/sites";
import { errorMessage } from "@/lib/utils";

const DUPLICATE = "This customer already has that site.";

type Picked = { _id: Id<"customers">; name: string; contact: string };

// The one site dialog, for three uses: New site from the Sites list, where the
// customer is not known yet and a Customer box asks; New site from a
// customer, whose site it will be; and Edit site on the site page, which adds
// Delete site. The address must be one of Google's suggestions; the unit and
// access notes are the owner's own words. A new site lands on its page.
export function SiteDialog({
  customerId,
  site,
  onClose,
}: {
  /** The customer a new site is for; without one the dialog asks. */
  customerId?: Id<"customers">;
  /** Edit this site; without one the dialog adds a new site. */
  site?: Doc<"sites">;
  onClose: () => void;
}) {
  const router = useRouter();
  const addSite = useAction(api.sites.add);
  const addCustomer = useAction(api.customers.add);
  const update = useAction(api.sites.update);
  const customers = useCustomers();
  // Saving makes the details call that closes the lookup's session, so a
  // retry after a failed save starts a new one.
  const [sessionToken, setSessionToken] = useState(newLookupSession);
  // An existing site starts picked as it stands, so only a re-pick asks Google.
  const [place, setPlace] = useState<PlaceSuggestion | null>(
    site
      ? {
          placeId: site.placeId,
          mainText: site.addressLine1,
          secondaryText: [site.city, site.region].filter(Boolean).join(", "),
        }
      : null,
  );
  const [unit, setUnit] = useState(site?.addressLine2 ?? "");
  const [accessNotes, setAccessNotes] = useState(site?.accessNotes ?? "");
  const [addressTyped, setAddressTyped] = useState(Boolean(site));
  // A site's customer never changes; only a new site from the Sites list asks.
  const fixed = site?.customerId ?? customerId;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [fresh, setFresh] = useState<CustomerInput | null>(null);
  const [freshErrors, setFreshErrors] = useState<CustomerErrors>({});
  // What the dialog is busy with, so each button says what is happening.
  const [working, setWorking] = useState<"saving" | "deleting" | null>(null);
  const busy = working !== null;
  const [error, setError] = useState("");

  const whose = fixed ?? picked?._id;
  const atPlace = useQuery(api.sites.atPlace, place ? { placeId: place.placeId } : "skip");
  const others = (atPlace ?? []).filter((s) => s.siteId !== site?._id);
  const duplicate = others.some((s) => s.customerId === whose && sameUnit(s.addressLine2, unit));
  const elsewhere = [
    ...new Set(others.filter((s) => s.customerId !== whose).map((s) => s.customerName)),
  ];
  const customerChosen = Boolean(fixed || picked || fresh);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{site ? "Edit site" : "New site"}</DialogTitle>
          <DialogDescription>
            {site
              ? "A corrected address renames the site. Anything already sent keeps the address it was sent with."
              : fixed
                ? "Where the work happens. Every proposal is for one site."
                : "Where the work is, then who it is for."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!place || duplicate || !customerChosen) return;
            const typed = { addressLine2: unit, accessNotes };
            // A new customer is checked as Add customer checks one, before
            // anything is sent.
            const contact = fresh ? customerSchema.safeParse(fresh) : null;
            if (contact && !contact.success) return setFreshErrors(customerErrors(contact.error));
            const newCustomer = contact?.data;
            setFreshErrors({});
            setWorking("saving");
            setError("");
            try {
              if (site) {
                if (place.placeId !== site.placeId)
                  await update({
                    siteId: site._id,
                    placeId: place.placeId,
                    sessionToken,
                    ...typed,
                  });
                else await update({ siteId: site._id, ...typed });
                onClose();
                return;
              }
              let siteId: Id<"sites"> | null = null;
              if (whose)
                siteId = await addSite({
                  customerId: whose,
                  placeId: place.placeId,
                  sessionToken,
                  ...typed,
                });
              else if (newCustomer)
                // The customer and their first site in one transaction, so a
                // refused address leaves no customer behind.
                ({ siteId } = await addCustomer({
                  ...newCustomer,
                  firstSite: { placeId: place.placeId, sessionToken, ...typed },
                }));
              // The dialog stays up, saving, until the site's page replaces
              // the one under it.
              if (siteId) router.push(`/sites/${siteId}`);
              else setWorking(null);
            } catch (err) {
              setError(errorMessage(err));
              setSessionToken(newLookupSession());
              setWorking(null);
            }
          }}
        >
          <FieldGroup className="gap-4">
            <Field data-invalid={(addressTyped && !place) || undefined}>
              <FieldLabel htmlFor="site-address">Address</FieldLabel>
              <AddressCombobox
                id="site-address"
                sessionToken={sessionToken}
                value={place}
                onChange={setPlace}
                onTyped={setAddressTyped}
                disabled={busy}
                invalid={addressTyped && !place}
              />
              {!place ? (
                <FieldDescription>{PICK_ADDRESS}</FieldDescription>
              ) : elsewhere.length ? (
                <FieldDescription className="text-amber-700">
                  Another customer already has this address: {elsewhere.join(", ")}
                </FieldDescription>
              ) : null}
            </Field>
            <Field data-invalid={duplicate || undefined}>
              <FieldLabel htmlFor="site-unit">Unit (optional)</FieldLabel>
              <Input
                id="site-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Apt 2, Unit B"
                maxLength={MAX_UNIT}
                disabled={busy}
                aria-invalid={duplicate || undefined}
              />
              <FieldError>{duplicate ? DUPLICATE : null}</FieldError>
            </Field>
            {fixed ? null : (
              <CustomerBox
                customers={customers ?? []}
                picked={picked}
                onPick={setPicked}
                fresh={fresh}
                onFresh={(next) => {
                  setFresh(next);
                  if (!next) setFreshErrors({});
                }}
                errors={freshErrors}
                disabled={busy}
              />
            )}
            <Field>
              <FieldLabel htmlFor="site-access">Access notes (optional)</FieldLabel>
              <Textarea
                id="site-access"
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
                placeholder="Gate code, parking, pets, who lets you in"
                maxLength={MAX_ACCESS_NOTES}
                disabled={busy}
              />
            </Field>
          </FieldGroup>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !place || duplicate || !customerChosen}>
            {working === "saving" ? "Saving…" : site ? "Save changes" : "Save site"}
          </Button>
        </form>
        {site ? (
          <DeleteSite
            site={site}
            working={working}
            setWorking={setWorking}
            onError={setError}
            onDeleted={() => router.replace("/sites")}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Who a new site from the Sites list is for: search the customers by name or
// phone and pick one, or add someone new right here with the fields and the
// checks Add customer uses.
function CustomerBox({
  customers,
  picked,
  onPick,
  fresh,
  onFresh,
  errors,
  disabled,
}: {
  customers: Doc<"customers">[];
  picked: Picked | null;
  onPick: (picked: Picked | null) => void;
  fresh: CustomerInput | null;
  onFresh: (fresh: CustomerInput | null) => void;
  errors: CustomerErrors;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const typed = search.trim();
  const matches = findCustomers(customers, typed);
  // Digits alone are a phone number, so they start the new customer's phone
  // rather than their name.
  const byPhone = Boolean(typed) && !/\p{L}/u.test(typed);

  if (picked)
    return (
      <Field>
        <FieldLabel>Customer</FieldLabel>
        <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm">
          <User aria-hidden className="size-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{picked.name}</span>
            {picked.contact ? (
              <span className="block truncate text-xs text-slate-500">{picked.contact}</span>
            ) : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onPick(null)}
          >
            Change
          </Button>
        </div>
      </Field>
    );

  if (fresh)
    return (
      <Field>
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">New customer</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onFresh(null)}
            >
              Pick existing instead
            </Button>
          </div>
          <CustomerFields
            value={fresh}
            onChange={onFresh}
            errors={errors}
            warnings={contactWarnings(fresh, customers)}
            disabled={disabled}
          />
        </div>
      </Field>
    );

  return (
    <Field>
      <FieldLabel htmlFor="site-customer">Customer</FieldLabel>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="site-customer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone"
          className="pl-8"
          disabled={disabled}
          autoComplete="off"
        />
      </div>
      {typed ? (
        <ul className="overflow-hidden rounded-md border bg-white">
          {matches.map((c) => {
            const contact = displayPhone(c.phone) || c.email;
            return (
              <li key={c._id}>
                <button
                  type="button"
                  onClick={() => onPick({ _id: c._id, name: c.name, contact })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <User aria-hidden className="size-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{contact}</span>
                </button>
              </li>
            );
          })}
          <li className={matches.length ? "border-t" : undefined}>
            <button
              type="button"
              onClick={() =>
                onFresh(
                  byPhone
                    ? { ...blankCustomer, phone: formatPhone(typed) }
                    : { ...blankCustomer, name: typed },
                )
              }
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
            >
              <Plus aria-hidden className="size-4 shrink-0" />
              {byPhone
                ? `Add a new customer with phone ${formatPhone(typed)}`
                : `Add “${typed}” as a new customer`}
            </button>
          </li>
        </ul>
      ) : (
        <FieldDescription>
          Type a name or phone number to find them, or to add someone new.
        </FieldDescription>
      )}
    </Field>
  );
}

// Delete site, at the foot of Edit site. Held back while the site has any
// proposal or invoice, with the reason beside it; the server refuses as well,
// whatever this showed. Its solutions and photos go with it, and the owner
// lands on the Sites list, since the page they were on is gone.
function DeleteSite({
  site,
  working,
  setWorking,
  onError,
  onDeleted,
}: {
  site: Doc<"sites">;
  working: "saving" | "deleting" | null;
  setWorking: (working: "deleting" | null) => void;
  onError: (message: string) => void;
  onDeleted: () => void;
}) {
  const remove = useMutation(api.sites.remove);
  // The header's own read, so the counts are the ones beside the tabs.
  const held = useQuery(api.sites.get, { siteId: site._id });
  const refusal = held ? siteDeleteRefusal(held.counts) : null;
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center justify-end gap-3 border-t pt-4">
      {refusal ? <p className="flex-1 text-xs text-slate-500">{refusal}</p> : null}
      <Button
        type="button"
        variant="destructive"
        size="lg"
        disabled={working !== null || !held || Boolean(refusal)}
        onClick={() => setConfirming(true)}
      >
        <Trash2 data-icon="inline-start" aria-hidden />{" "}
        {working === "deleting" ? "Deleting…" : "Delete site"}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {siteStreetLine(site)}?</AlertDialogTitle>
            <AlertDialogDescription>
              The site has no proposals or invoices. Any solutions priced for it and any photos
              taken there are deleted with it. To move it to another customer, delete it here and
              add it again for them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep site</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirming(false);
                setWorking("deleting");
                onError("");
                try {
                  await remove({ siteId: site._id });
                  onDeleted();
                } catch (err) {
                  onError(errorMessage(err));
                  setWorking(null);
                }
              }}
            >
              Delete site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
