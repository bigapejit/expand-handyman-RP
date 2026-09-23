"use client";

import "@/app/paper-print.css";
import "@/app/proposal-paper.css";
import "@/app/invoice-paper.css";

import { useQuery } from "convex/react";

import { InvoicePaper } from "@/components/invoice-paper";
import { LinkNotLive } from "@/components/link-not-live";
import { PaperFrame, PaperLoading, PaperTop } from "@/components/paper-screen";
import { api } from "@/convex/_generated/api";
import { invoicePaperTitle } from "@/lib/invoice-paper";

// The customer reading a sent invoice through its **Invoice link**
// (CONTEXT.md): the invoice paper under the paper screen's top bar, and
// nothing else. Nothing is signed, so there is no sign bar; nothing is
// logged, so there is no open to report and no heartbeat. The page follows
// the invoice live, and a link that stops opening it says so.
export function InvoiceLinkPage({ token }: { token: string }) {
  const page = useQuery(api.invoiceLinks.page, { token });
  if (page === undefined) return <PaperLoading />;
  if (page === null) return <LinkNotLive what="invoice" />;
  const { paper } = page;
  return (
    <PaperFrame top={<PaperTop title={invoicePaperTitle(paper)} />}>
      <InvoicePaper invoice={paper} />
    </PaperFrame>
  );
}
