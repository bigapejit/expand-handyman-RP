"use client";

// PROTOTYPE (wayfinder ticket #21): the customer dialog in add and edit mode
// (#14, #5). Save is a stub: nothing is written.
import { useState } from "react";

import { CustomerFields, blankCustomer } from "@/components/customer-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CustomerInput } from "@/lib/customer";

export function CustomerDialog({
  mode,
  initial,
  onClose,
}: {
  mode: "add" | "edit";
  initial?: CustomerInput;
  onClose: () => void;
}) {
  const [value, setValue] = useState<CustomerInput>(initial ?? blankCustomer);

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add customer" : "Edit customer"}</DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Name, email and phone. A first site is optional; add more on the customer's Sites tab."
              : "Changes apply to drafts only. Anything already sent keeps what it was sent with."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onClose();
          }}
        >
          <CustomerFields value={value} onChange={setValue} errors={{}} disabled={false} />
          <p className="text-xs text-amber-700">Prototype: saving does nothing.</p>
          <Button type="submit">{mode === "add" ? "Save customer" : "Save changes"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
