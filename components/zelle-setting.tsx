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
import { DefaultZelleTag } from "@/lib/expand-business";
import { errorMessage } from "@/lib/utils";

// The **Zelle tag** the invoice paper and the Pay sheet name, in the Invoices
// page's header, with its own small dialog to change it. The one setting the
// app has.
export function ZelleSetting() {
  const settings = useQuery(api.settings.get);
  const [editing, setEditing] = useState(false);

  return (
    <>
      <p className="text-sm text-slate-600">
        Zelle tag:{" "}
        <span className="font-medium text-slate-900">{settings?.zelleTag ?? "…"}</span>
        <span aria-hidden> · </span>
        <button
          type="button"
          disabled={settings === undefined}
          onClick={() => setEditing(true)}
          aria-label="Edit the Zelle tag"
          className="font-medium text-primary hover:underline disabled:opacity-50"
        >
          Edit
        </button>
      </p>
      {editing && settings ? (
        <ZelleDialog current={settings.zelleTag} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}

function ZelleDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const save = useMutation(api.settings.setZelleTag);
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
          <DialogTitle>Zelle tag</DialogTitle>
          <DialogDescription>
            The tag customers send a Zelle payment to, as your bank shows it. Every invoice,
            sent or not, and its Pay sheet name the new tag from now on.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await save({ zelleTag: value });
              setBusy(false);
              onClose();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="zelle-tag">Tag</FieldLabel>
            <Input
              id="zelle-tag"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={value}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
            />
            <FieldDescription className={error ? "text-destructive" : undefined}>
              {error ||
                `6 to 40 letters, digits and hyphens. Leave it empty for ${DefaultZelleTag}.`}
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
