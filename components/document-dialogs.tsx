"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CustomerForm } from "./customer-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { errorMessage } from "@/lib/utils";
import { MAX_PDF_BYTES } from "@/lib/signing";
import { uploadFile } from "@/lib/files";
import { displayPhone } from "@/lib/customer";
import { useCustomers } from "@/hooks/use-customers";

// Upload PDF always asks whose document it is. With no customers yet, the
// first one is added on the way; `customerId` pre-fills the choice.
export function UploadPdfDialog({
  customerId: initialCustomerId = "",
  onClose,
}: {
  customerId?: string;
  onClose: () => void;
}) {
  const customers = useCustomers();
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const adding = customers?.length === 0 && !customerId;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{adding ? "Add customer" : "Upload a document"}</DialogTitle>
          <DialogDescription>
            {adding
              ? "Who they are and how to reach them."
              : "Choose a PDF to prepare for a customer signature."}
          </DialogDescription>
        </DialogHeader>
        {adding ? (
          <CustomerForm busy={busy} setBusy={setBusy} onSaved={setCustomerId} />
        ) : (
          <UploadForm
            customers={customers ?? []}
            customerId={customerId}
            setCustomerId={setCustomerId}
            busy={busy}
            setBusy={setBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({
  customers,
  customerId,
  setCustomerId,
  busy,
  setBusy,
}: {
  customers: { _id: string; name: string; email: string; phone: string }[];
  customerId: string;
  setCustomerId: (id: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const getUploadUrl = useMutation(api.documents.uploadUrl);
  const createDocument = useAction(api.pdfActions.create);
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const data = new FormData(e.currentTarget);
        const file = data.get("pdf") as File;
        try {
          if (
            !file ||
            file.size > MAX_PDF_BYTES ||
            !file.name.toLowerCase().endsWith(".pdf")
          )
            throw new Error("Choose a PDF under 20 MB.");
          const id = await uploadFile(await getUploadUrl(), file);
          const docId = await createDocument({
            storageId: id as Id<"_storage">,
            customerId: customerId as Id<"customers">,
            title: String(data.get("title")) || file.name.replace(/\.pdf$/i, ""),
          });
          router.push(`/documents/${docId}`);
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="customer">Customer</Label>
        <select
          id="customer"
          name="customer"
          required
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="" disabled>
            Select a customer
          </option>
          {customers.map((c) => (
            <option key={c._id} value={c._id}>
              {[c.name, c.email || displayPhone(c.phone)].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="title">Document title</Label>
        <Input
          name="title"
          id="title"
          placeholder="e.g. Bathroom repair agreement"
          maxLength={200}
        />
      </div>
      <div className="rounded-lg border border-dashed bg-muted/30 p-6">
        <Label htmlFor="pdf" className="mb-3 flex items-center gap-2">
          <Upload size={18} />
          PDF document
        </Label>
        <Input id="pdf" name="pdf" type="file" accept="application/pdf,.pdf" required />
        <p className="mt-3 text-xs text-muted-foreground">
          Up to 20 MB · 100 pages · No password protection
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Uploading and checking PDF…" : "Upload & place signature"}
      </Button>
    </form>
  );
}
