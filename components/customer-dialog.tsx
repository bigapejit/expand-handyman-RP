"use client";

import { useAction, useMutation } from "convex/react";
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
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCustomers } from "@/hooks/use-customers";
import {
  contactWarnings,
  customerErrors,
  customerSchema,
  displayPhone,
  type CustomerErrors,
  type CustomerInput,
} from "@/lib/customer";
import type { PlaceSuggestion } from "@/lib/places";
import { errorMessage } from "@/lib/utils";

type Customer = Pick<Doc<"customers">, "_id" | "name" | "email" | "phone">;

// Who was saved, and the first site added with them, if one was: the owner
// lands on that site's page, where the work is.
export type SavedCustomer = { customerId: Id<"customers">; siteId: Id<"sites"> | null };

// One dialog for Add customer on the Customers list and Edit on the customer
// page: the same fields and the same validation, so corrections work the way
// entry does.
export function CustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  /** Edit this customer; without one the dialog adds a new customer. */
  customer?: Customer;
  onClose: () => void;
  onSaved?: (saved: SavedCustomer) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{customer ? "Edit customer" : "Add customer"}</DialogTitle>
          <DialogDescription>
            {customer
              ? "Changes apply to drafts only. Anything already sent keeps what it was sent with."
              : "Name, email and phone. A first site is optional; add more from the customer's page."}
          </DialogDescription>
        </DialogHeader>
        <CustomerForm
          customer={customer}
          busy={busy}
          setBusy={setBusy}
          onSaved={(saved) => (onSaved ?? onClose)(saved)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CustomerForm({
  customer,
  busy,
  setBusy,
  onSaved,
}: {
  customer?: Customer;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSaved: (saved: SavedCustomer) => void;
}) {
  const add = useAction(api.customers.add);
  const update = useMutation(api.customers.update);
  const customers = useCustomers();
  const [value, setValue] = useState<CustomerInput>(
    customer
      ? {
          name: customer.name,
          email: customer.email,
          // A row saved before validation shows exactly as it was typed, and
          // is normalized when this dialog saves it.
          phone: displayPhone(customer.phone),
        }
      : blankCustomer,
  );
  const [fieldErrors, setFieldErrors] = useState<CustomerErrors>({});
  const [error, setError] = useState("");
  // Saving makes the details call that closes the lookup's session, so a
  // retry after a failed save starts a new one.
  const [sessionToken, setSessionToken] = useState(newLookupSession);
  const [firstSite, setFirstSite] = useState<PlaceSuggestion | null>(null);
  const [addressTyped, setAddressTyped] = useState(false);
  const unpicked = !customer && addressTyped && !firstSite;

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        const parsed = customerSchema.safeParse(value);
        if (!parsed.success) return setFieldErrors(customerErrors(parsed.error));
        setFieldErrors({});
        setBusy(true);
        try {
          let saved: SavedCustomer;
          if (customer) {
            await update({ customerId: customer._id, ...parsed.data });
            saved = { customerId: customer._id, siteId: null };
          } else {
            saved = await add({
              ...parsed.data,
              firstSite: firstSite
                ? { placeId: firstSite.placeId, sessionToken }
                : undefined,
            });
          }
          setBusy(false);
          onSaved(saved);
        } catch (err) {
          setError(errorMessage(err));
          setSessionToken(newLookupSession());
          setBusy(false);
        }
      }}
    >
      <CustomerFields
        value={value}
        onChange={setValue}
        errors={fieldErrors}
        warnings={contactWarnings(value, customers ?? [], customer?._id)}
        disabled={busy}
      />
      {customer ? null : (
        <Field data-invalid={unpicked || undefined}>
          <FieldLabel htmlFor="first-site">First site address (optional)</FieldLabel>
          <AddressCombobox
            id="first-site"
            sessionToken={sessionToken}
            value={firstSite}
            onChange={setFirstSite}
            onTyped={setAddressTyped}
            disabled={busy}
            invalid={unpicked}
          />
          <FieldDescription className={unpicked ? "text-destructive" : undefined}>
            {unpicked ? PICK_ADDRESS : "Leave blank to add sites later."}
          </FieldDescription>
        </Field>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || unpicked}>
        {busy ? "Saving…" : customer ? "Save changes" : "Save customer"}
      </Button>
    </form>
  );
}
