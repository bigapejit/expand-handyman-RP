"use client";

import { useMutation, useQuery } from "convex/react";
import { Eye, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { HubLoading } from "@/components/customer-hub-shell";
import { InvoiceChip } from "@/components/invoice-chips";
import {
  InvoiceDraftLines,
  InvoiceLines,
  type InvoiceDraftPatch,
} from "@/components/invoice-lines";
import { InvoiceSending, type PanelInvoice } from "@/components/invoice-sending";
import { SidePanel, useSidePanel } from "@/components/side-panel";
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
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { InvoicePanelParam, invoicePaperHref } from "@/lib/invoices";
import { errorMessage } from "@/lib/utils";

// The **Invoice panel**: one invoice slid in over a hub tab, held in
// `?invoice=<id>` (lib/side-panel.ts) so a reload, a copied link and Back all
// mean the same thing. The Invoices tab opens it over its list, and the
// Proposals tab over an approved proposal's panel, which comes back when this
// one closes. A link naming no invoice, or another customer's, just shows the
// tab, and whatever panel the tab had open (`otherwise`).
export function InvoicePanelHost({
  customerId,
  otherwise = null,
}: {
  customerId: string;
  otherwise?: ReactNode;
}) {
  const { openId, close } = useSidePanel(InvoicePanelParam);
  if (!openId) return otherwise;
  return (
    <OpenInvoice
      key={openId}
      invoiceId={openId}
      customerId={customerId}
      otherwise={otherwise}
      onClose={close}
    />
  );
}

function OpenInvoice({
  invoiceId,
  customerId,
  otherwise,
  onClose,
}: {
  invoiceId: string;
  customerId: string;
  otherwise: ReactNode;
  onClose: () => void;
}) {
  const today = usePacificToday();
  const invoice = useQuery(api.invoices.panel, { invoiceId, today });

  if (invoice === undefined) {
    return (
      <SidePanel title="Invoice" onClose={onClose}>
        <HubLoading label="Loading invoice" />
      </SidePanel>
    );
  }
  if (invoice === null || invoice.customerId !== customerId) return otherwise;
  return <InvoicePanel invoice={invoice} onClose={onClose} />;
}

// Everything about one invoice: its header, its lines and money, the sending
// block, and a footer. A draft's lines are open for writing, with Send in the
// sending block and Delete in the footer; once sent, the lines are read only.
// Mark paid under the sending block, and Download and Void in the footer, are
// the next ticket's.
function InvoicePanel({ invoice, onClose }: { invoice: PanelInvoice; onClose: () => void }) {
  const update = useMutation(api.invoices.update);
  const remove = useMutation(api.invoices.remove);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // A refusal belongs where the edit was made: the list's own error line is
  // behind the panel.
  const [refusal, setRefusal] = useState("");
  // An amount typed in the draft that cannot be read yet (InvoiceDraftLines).
  const [unreadable, setUnreadable] = useState(false);
  const isDraft = invoice.state === "draft";

  const save = async (patch: InvoiceDraftPatch): Promise<boolean> => {
    try {
      await update({ invoiceId: invoice.invoiceId, ...patch });
      setRefusal("");
      return true;
    } catch (err) {
      setRefusal(errorMessage(err));
      return false;
    }
  };

  return (
    <SidePanel
      title={invoice.title}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{invoice.customerName}</span>
          <span aria-hidden>·</span>
          <span>{invoice.proposalCode}</span>
          <InvoiceChip state={invoice.state} standing={invoice.standing} />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        {refusal ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {refusal}
          </p>
        ) : null}

        {isDraft ? (
          <InvoiceDraftLines invoice={invoice} onSave={save} onUnreadable={setUnreadable} />
        ) : (
          <InvoiceLines invoice={invoice} />
        )}

        <InvoiceSending invoice={invoice} amountUnreadable={isDraft && unreadable} />

        <div className="flex flex-wrap items-center gap-1 border-t pt-4">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a href={invoicePaperHref(invoice.invoiceId)} target="_blank" rel="noreferrer" />
            }
          >
            <Eye data-icon="inline-start" aria-hidden /> View paper
          </Button>
          <span className="flex-1" />
          {isDraft ? (
            <Button variant="destructive" size="lg" onClick={() => setConfirmingDelete(true)}>
              <Trash2 data-icon="inline-start" aria-hidden /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer never saw it and it has no number yet, so nothing is left behind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirmingDelete(false);
                try {
                  await remove({ invoiceId: invoice.invoiceId });
                  onClose();
                } catch (err) {
                  setRefusal(errorMessage(err));
                }
              }}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidePanel>
  );
}
