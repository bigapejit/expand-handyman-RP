"use client";

import "@/app/invoice-paper.css";

import { useQuery } from "convex/react";
import { useState } from "react";

import { InvoicePaper } from "@/components/invoice-paper";
import {
  PaperFrame,
  PaperLoading,
  PaperTop,
  PaperTopWithDownload,
  Strip,
} from "@/components/paper-screen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { invoicePaperState, invoicePaperTitle } from "@/lib/invoice-paper";

// The staff paper for an invoice: the owner reading it as the customer will,
// from View paper in the invoice panel, for any invoice. A draft is laid out
// as if sent the moment the page opened, with "Draft" where the number goes
// (invoices.paper). A sent or void invoice offers its PDF copy in the top bar.
// Nothing here is logged: the owner checking their own work is nobody's view.
export function StaffInvoicePaper({ invoiceId }: { invoiceId: Id<"invoices"> }) {
  const paper = useQuery(api.invoices.paper, { invoiceId });
  const [openedAt] = useState(() => Date.now());

  if (paper === undefined) return <PaperLoading />;
  if (paper === null) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          This invoice&rsquo;s paper isn&rsquo;t available here.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the invoice from the customer&rsquo;s Invoices tab.
        </p>
      </div>
    );
  }

  const { state, ...invoice } = paper;
  const title = invoicePaperTitle(invoice);
  return (
    <PaperFrame
      top={
        state === "draft" ? (
          <PaperTop title={title}>
            <Strip strip={{ tone: "note", body: "Preview of a Draft" }} />
          </PaperTop>
        ) : (
          <PaperTopWithDownload
            title={title}
            source={{ invoiceId }}
            state={invoicePaperState(invoice)}
          />
        )
      }
    >
      <InvoicePaper invoice={{ ...invoice, sentAt: invoice.sentAt ?? openedAt }} />
    </PaperFrame>
  );
}
