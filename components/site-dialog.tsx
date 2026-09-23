"use client";

import { useAction, useQuery } from "convex/react";
import { useState } from "react";

import {
  AddressCombobox,
  PICK_ADDRESS,
  newLookupSession,
} from "@/components/address-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { PlaceSuggestion } from "@/lib/places";
import { MAX_ACCESS_NOTES, MAX_UNIT, sameUnit } from "@/lib/sites";
import { errorMessage } from "@/lib/utils";

const DUPLICATE = "This customer already has that site.";

// Add or edit one of a customer's sites. The address must be one of Google's
// suggestions; the unit and access notes are the owner's own words.
export function SiteDialog({
  customerId,
  site,
  onClose,
}: {
  customerId: Id<"customers">;
  /** Edit this site; without one the dialog adds a new site. */
  site?: Doc<"sites">;
  onClose: () => void;
}) {
  const add = useAction(api.sites.add);
  const update = useAction(api.sites.update);
  const [sessionToken] = useState(newLookupSession);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const atPlace = useQuery(
    api.sites.atPlace,
    place ? { placeId: place.placeId } : "skip",
  );
  const others = (atPlace ?? []).filter((s) => s.siteId !== site?._id);
  const duplicate = others.some(
    (s) => s.customerId === customerId && sameUnit(s.addressLine2, unit),
  );
  const elsewhere = [
    ...new Set(
      others.filter((s) => s.customerId !== customerId).map((s) => s.customerName),
    ),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{site ? `Edit ${site.name}` : "Add site"}</DialogTitle>
          <DialogDescription>
            {site
              ? "A corrected address renames the site. Anything already sent keeps the address it was sent with."
              : "Where the work happens. Every proposal is for one site."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!place || duplicate) return;
            setBusy(true);
            setError("");
            try {
              const typed = { addressLine2: unit, accessNotes };
              if (!site)
                await add({ customerId, placeId: place.placeId, sessionToken, ...typed });
              else if (place.placeId !== site.placeId)
                await update({ siteId: site._id, placeId: place.placeId, sessionToken, ...typed });
              else await update({ siteId: site._id, ...typed });
              onClose();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
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
          <Button type="submit" disabled={busy || !place || duplicate}>
            {busy ? "Saving…" : site ? "Save changes" : "Save site"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
