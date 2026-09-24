"use client";

import { useAction, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { InvoicePaperState } from "@/lib/invoice-paper";
import type { PdfCopyState } from "@/lib/pdf-copy";
import { errorMessage } from "@/lib/utils";

// Download of a proposal's or an invoice's **PDF copy** (CONTEXT.md;
// ADR 0002), for whichever surface draws the button: the proposal or invoice
// panel, either staff paper page, or the top bar of a signing or invoice
// link. It asks for the stored file first and renders only when there is
// none, so a second press, the owner's or the customer's, never spends
// another render. Ported from FRSG's PaperDownload, split from its
// button because the panel draws a staff button and the paper a paper one.
//
// The owner names the proposal or the invoice; the customer names nothing but
// their signing or invoice link, which is the whole of their authority. None
// is ever logged as a view. No source reads nothing, for a paper with no PDF
// copy to offer.
export type PdfSource =
  | { proposalId: Id<"proposals"> }
  | { token: string }
  | { invoiceId: Id<"invoices"> }
  | { invoiceToken: string };

export function usePdfDownload(source: PdfSource | null) {
  const owner = source && "proposalId" in source ? source : null;
  const customer = source && "token" in source ? source : null;
  const invoiceOwner = source && "invoiceId" in source ? source : null;
  const invoiceCustomer =
    source && "invoiceToken" in source ? { token: source.invoiceToken } : null;
  const ownerFile = useQuery(api.pdfCopies.downloadForOwner, owner ?? "skip");
  const customerFile = useQuery(api.pdfCopies.downloadForCustomer, customer ?? "skip");
  const invoiceOwnerFile = useQuery(api.pdfCopies.invoiceDownloadForOwner, invoiceOwner ?? "skip");
  const invoiceCustomerFile = useQuery(
    api.pdfCopies.invoiceDownloadForCustomer,
    invoiceCustomer ?? "skip",
  );
  const renderForOwner = useAction(api.pdfCopies.renderForOwner);
  const renderForCustomer = useAction(api.pdfCopies.renderForCustomer);
  const renderInvoiceForOwner = useAction(api.pdfCopies.renderInvoiceForOwner);
  const renderInvoiceForCustomer = useAction(api.pdfCopies.renderInvoiceForCustomer);
  const stored = owner
    ? ownerFile
    : customer
      ? customerFile
      : invoiceOwner
        ? invoiceOwnerFile
        : invoiceCustomerFile;
  // What a press with no stored file asks the server to make.
  const render = owner
    ? () => renderForOwner(owner)
    : customer
      ? () => renderForCustomer(customer)
      : invoiceOwner
        ? () => renderInvoiceForOwner(invoiceOwner)
        : invoiceCustomer
          ? () => renderInvoiceForCustomer(invoiceCustomer)
          : null;

  const [working, setWorking] = useState(false);
  // What stopped the last press, in the server's words: someone who presses
  // Download and gets nothing has no other way to find out why.
  const [fault, setFault] = useState<string | null>(null);
  // Undefined is "not read yet" and null is "there is no file". Pressed on the
  // first, the button would send the server off to render a file it is
  // holding, so it waits the moment the read takes.
  const ready = source !== null && stored !== undefined && !working;

  const download = async () => {
    if (!ready) return;
    setWorking(true);
    try {
      const file = stored
        ? { outcome: "ready" as const, ...stored }
        : render
          ? await render()
          : null;
      if (!file) return;
      if (file.outcome === "unavailable") {
        setFault(file.reason);
        return;
      }
      setFault(null);
      await saveFile(file.url, file.filename);
    } catch (reason) {
      setFault(errorMessage(reason) || "That PDF couldn't be downloaded.");
    } finally {
      setWorking(false);
    }
  };

  return { download, ready, working, fault };
}

// The button's words: a signed proposal's file is the signed copy, and every
// other paper's, an invoice's whatever its stamp, is the PDF.
export function pdfDownloadLabel(
  state: PdfCopyState | InvoicePaperState,
  working: boolean,
): string {
  if (working) return "Preparing…";
  return state === "approved" ? "Download signed copy" : "Download PDF";
}

// Saved through a fetched blob rather than by opening the storage URL: the URL
// is on Convex's origin, where the `download` attribute cannot name the file,
// and "Expand Handyman Proposal 441094TH-P2.pdf" is the name it should be filed
// under. If the bytes cannot be fetched here, the URL opens in a tab instead
// and the browser names the file.
async function saveFile(url: string, filename: string): Promise<void> {
  let blob: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The file answered ${response.status}.`);
    blob = await response.blob();
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked after the click has been handed to the browser; a synchronous
    // revoke can beat the download on Safari.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}
