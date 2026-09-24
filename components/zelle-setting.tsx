"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

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
import { api } from "@/convex/_generated/api";
import { DefaultZelleEmail } from "@/lib/expand-business";
import { errorMessage } from "@/lib/utils";

// The Zelle address the invoice paper prints, in the Invoices page's header,
// with its own small dialog to change it. The one setting the app has.
export function ZelleSetting() {
  const settings = useQuery(api.settings.get);
  const [editing, setEditing] = useState(false);

  return (
    <>
      <p className="text-sm text-slate-600">
        Zelle:{" "}
        <span className="font-medium text-slate-900">{settings?.zelleEmail ?? "…"}</span>
        <span aria-hidden> · </span>
        <button
          type="button"
          disabled={settings === undefined}
          onClick={() => setEditing(true)}
          aria-label="Edit the Zelle email"
          // Expand: padding a phone's thumb can find, cancelled by the margin so
          // the line reads the same.
          className="font-medium text-primary hover:underline disabled:opacity-50 max-md:-m-2 max-md:p-2"
        >
          Edit
        </button>
      </p>
      {editing && settings ? (
        <ZelleDialog current={settings.zelleEmail} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}

function ZelleDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const save = useMutation(api.settings.setZelleEmail);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Zelle email</DialogTitle>
          <DialogDescription>
            Where the invoice paper tells customers to send a Zelle payment. Every invoice,
            sent or not, prints the new address from now on.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await save({ zelleEmail: value });
              setBusy(false);
              onClose();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="zelle-email">Email</FieldLabel>
            <Input
              id="zelle-email"
              type="email"
              autoComplete="off"
              value={value}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
            />
            <FieldDescription className={error ? "text-destructive" : undefined}>
              {error || `Leave it empty for ${DefaultZelleEmail}.`}
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
