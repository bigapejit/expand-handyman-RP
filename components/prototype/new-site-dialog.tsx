"use client";

import { useAction } from "convex/react";
import { Plus, Search, User } from "lucide-react";
import { useState } from "react";

import {
  AddressCombobox,
  PICK_ADDRESS,
  newLookupSession,
} from "@/components/address-combobox";
import { CustomerFields, blankCustomer } from "@/components/customer-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCustomers } from "@/hooks/use-customers";
import type { CustomerInput } from "@/lib/customer";
import type { PlaceSuggestion } from "@/lib/places";
import { MAX_ACCESS_NOTES } from "@/lib/sites";
import { errorMessage } from "@/lib/utils";

// PROTOTYPE (#90): New site as issue #88 decided it. Address first, then who
// it is for: search the customers, or add a new one right here. Saves for
// real through the existing rails (customers.add takes a first site).
export function NewSiteDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (siteId: Id<"sites">) => void;
}) {
  const customers = useCustomers();
  const addSite = useAction(api.sites.add);
  const addCustomer = useAction(api.customers.add);
  const [sessionToken, setSessionToken] = useState(newLookupSession);
  const [place, setPlace] = useState<PlaceSuggestion | null>(null);
  const [addressTyped, setAddressTyped] = useState(false);
  const [accessNotes, setAccessNotes] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ _id: Id<"customers">; name: string } | null>(null);
  const [fresh, setFresh] = useState<CustomerInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const query = search.trim().toLowerCase();
  const matches = query
    ? (customers ?? [])
        .filter((c) => c.name.toLowerCase().includes(query))
        .slice(0, 5)
    : [];
  const ready = place && (picked || (fresh && fresh.name.trim()));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New site</DialogTitle>
          <DialogDescription>Where the work is, then who it is for.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready || !place) return;
            setBusy(true);
            setError("");
            try {
              if (picked) {
                const siteId = await addSite({
                  customerId: picked._id,
                  placeId: place.placeId,
                  sessionToken,
                  addressLine2: "",
                  accessNotes,
                });
                onSaved(siteId);
              } else if (fresh) {
                // The real build would carry access notes through; the
                // customers.add rail does not take them yet.
                await addCustomer({
                  ...fresh,
                  firstSite: { placeId: place.placeId, sessionToken },
                });
                onClose();
              }
            } catch (err) {
              setError(errorMessage(err));
              setSessionToken(newLookupSession());
              setBusy(false);
            }
          }}
        >
          <Field data-invalid={(addressTyped && !place) || undefined}>
            <FieldLabel htmlFor="new-site-address">Address</FieldLabel>
            <AddressCombobox
              id="new-site-address"
              sessionToken={sessionToken}
              value={place}
              onChange={setPlace}
              onTyped={setAddressTyped}
              disabled={busy}
              invalid={addressTyped && !place}
            />
            {!place ? <FieldDescription>{PICK_ADDRESS}</FieldDescription> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="new-site-customer">Customer</FieldLabel>
            {picked ? (
              <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm">
                <User aria-hidden className="size-4 text-slate-400" />
                <span className="flex-1 font-medium">{picked.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
                  Change
                </Button>
              </div>
            ) : fresh ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">New customer</p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setFresh(null)}>
                    Pick existing instead
                  </Button>
                </div>
                <CustomerFields value={fresh} onChange={setFresh} disabled={busy} />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="new-site-customer"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name"
                    className="pl-8"
                    disabled={busy}
                    autoComplete="off"
                  />
                </div>
                {matches.length || query ? (
                  <ul className="overflow-hidden rounded-md border bg-white">
                    {matches.map((c) => (
                      <li key={c._id}>
                        <button
                          type="button"
                          onClick={() => setPicked({ _id: c._id, name: c.name })}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <User aria-hidden className="size-4 text-slate-400" />
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="text-xs text-slate-500">{c.email}</span>
                        </button>
                      </li>
                    ))}
                    <li className={matches.length ? "border-t" : ""}>
                      <button
                        type="button"
                        onClick={() => setFresh({ ...blankCustomer, name: search.trim() })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
                      >
                        <Plus aria-hidden className="size-4" />
                        Add &ldquo;{search.trim()}&rdquo; as a new customer
                      </button>
                    </li>
                  </ul>
                ) : (
                  <FieldDescription>Type a name to find them, or to add someone new.</FieldDescription>
                )}
              </div>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="new-site-access">Access notes (optional)</FieldLabel>
            <Textarea
              id="new-site-access"
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
              placeholder="Gate code, parking, pets, who lets you in"
              maxLength={MAX_ACCESS_NOTES}
              disabled={busy}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy || !ready}>
            {busy ? "Saving…" : "Save site"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
