"use client";

import { useMutation, useQuery } from "convex/react";
import { Ban, Download, Eye, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { HubLoading } from "@/components/hub-section";
import { InvoiceChip } from "@/components/invoice-chips";
import {
  InvoiceDraftLines,
  InvoiceLines,
  type InvoiceDraftPatch,
} from "@/components/invoice-lines";
import { InvoicePayment } from "@/components/invoice-payment";
import { InvoiceSending, type PanelInvoice } from "@/components/invoice-sending";
import { pdfDownloadLabel, usePdfDownload } from "@/components/pdf-download";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { InvoicePanelParam, invoicePaperHref } from "@/lib/invoices";
import { errorMessage } from "@/lib/utils";

// The **Invoice panel**: one invoice slid in over a hub tab, held in
// `?invoice=<id>` (lib/side-panel.ts) so a reload, a copied link and Back all
// mean the same thing. The Invoices tab opens it over its list, and the
// Proposals tab over an approved proposal's panel, which comes back when this
// one closes. A link naming no invoice, or one from another site, just shows
// the tab, and whatever panel the tab had open (`otherwise`).
export function InvoicePanelHost({
  siteId,
  otherwise = null,
}: {
  siteId: Id<"sites">;
  otherwise?: ReactNode;
}) {
  const { openId, close } = useSidePanel(InvoicePanelParam);
  if (!openId) return otherwise;
  return (
    <OpenInvoice
      key={openId}
      invoiceId={openId}
      siteId={siteId}
      otherwise={otherwise}
      onClose={close}
    />
  );
}

function OpenInvoice({
  invoiceId,
  siteId,
  otherwise,
  onClose,
}: {
  invoiceId: string;
  siteId: Id<"sites">;
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
  if (invoice === null || invoice.siteId !== siteId) return otherwise;
  return <InvoicePanel invoice={invoice} onClose={onClose} />;
}

// Everything about one invoice: its header, its lines and money, the sending
// block, its payment, and a footer. A draft's lines are open for writing, with
// Send in the sending block and Delete in the footer; once sent, the lines are
// read only, the payment block sits under the sending block, Download joins
// the footer for the PDF copy, and so does Void while no payment stands and
// none is on its way.
function InvoicePanel({ invoice, onClose }: { invoice: PanelInvoice; onClose: () => void }) {
  const update = useMutation(api.invoices.update);
  const remove = useMutation(api.invoices.remove);
  const voidInvoice = useMutation(api.invoices.voidInvoice);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  // A refusal belongs where the edit was made: the list's own error line is
  // behind the panel.
  const [refusal, setRefusal] = useState("");
  // An amount typed in the draft that cannot be read yet (InvoiceDraftLines).
  const [unreadable, setUnreadable] = useState(false);
  const isDraft = invoice.state === "draft";
  // Void is refused while a payment stands, marking it unpaid coming first,
  // and while a bank payment is on its way through Stripe.
  const voidable =
    invoice.state === "sent" && invoice.payment === null && invoice.onItsWay === null;
  // A sent or void invoice has a PDF copy; a draft has none.
  const pdf = usePdfDownload(isDraft ? null : { invoiceId: invoice.invoiceId });
  const shownRefusal = refusal || pdf.fault;

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
        {shownRefusal ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {shownRefusal}
          </p>
        ) : null}

        {isDraft ? (
          <InvoiceDraftLines invoice={invoice} onSave={save} onUnreadable={setUnreadable} />
        ) : (
          <InvoiceLines invoice={invoice} />
        )}

        <InvoiceSending invoice={invoice} amountUnreadable={isDraft && unreadable} />

        <InvoicePayment invoice={invoice} />

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
          {invoice.state !== "draft" ? (
            <Button variant="outline" disabled={!pdf.ready} onClick={() => void pdf.download()}>
              <Download data-icon="inline-start" aria-hidden />
              {pdfDownloadLabel(invoice.state, pdf.working)}
            </Button>
          ) : null}
          <span className="flex-1" />
          {voidable ? (
            <Button variant="outline" onClick={() => setConfirmingVoid(true)}>
              <Ban data-icon="inline-start" aria-hidden /> Void
            </Button>
          ) : null}
          {isDraft ? (
            <Button variant="destructive" size="lg" onClick={() => setConfirmingDelete(true)}>
              <Trash2 data-icon="inline-start" aria-hidden /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog open={confirmingVoid} onOpenChange={setConfirmingVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void {invoice.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              It keeps its number and its link, which then shows the paper stamped VOID with
              nothing due. Nobody is emailed, and it can&rsquo;t be undone.
              {invoice.kind === "final"
                ? " Job done comes back on the proposal, to raise the final invoice again."
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason (optional, the customer never sees it)</Label>
            <Textarea
              id="void-reason"
              rows={2}
              maxLength={500}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirmingVoid(false);
                try {
                  await voidInvoice({ invoiceId: invoice.invoiceId, reason: voidReason });
                  setVoidReason("");
                  setRefusal("");
                } catch (err) {
                  setRefusal(errorMessage(err));
                }
              }}
            >
              Void invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
