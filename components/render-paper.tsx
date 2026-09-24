"use client";

import { useQuery } from "convex/react";

import { InvoicePaper } from "@/components/invoice-paper";
import { LinkNotLive } from "@/components/link-not-live";
import { PaperFrame, PaperLoading, PaperScreen, PaperTop } from "@/components/paper-screen";
import type { PaperFooter } from "@/components/proposal-paper";
import { api } from "@/convex/_generated/api";
import { invoicePaperTitle } from "@/lib/invoice-paper";

// The paper under a render pass, for the PDF renderer: exactly what the
// customer's link shows, a proposal's or an invoice's, with no sign bar, no
// Download and nothing reported anywhere (convex/pdfCopies.ts, `paper`). A
// pass that has expired, been used, or outlived the paper it was made for
// opens nothing.
export function RenderPaper({ pass, footer }: { pass: string; footer: PaperFooter }) {
  const page = useQuery(api.pdfCopies.paper, { pass });
  if (page === undefined) return <PaperLoading />;
  if (page === null) return <LinkNotLive what="proposal" />;
  if (page.subject === "proposal") return <PaperScreen paper={page.paper} footer={footer} />;
  return (
    <PaperFrame top={<PaperTop title={invoicePaperTitle(page.paper)} />}>
      <InvoicePaper invoice={page.paper} footer={footer} />
    </PaperFrame>
  );
}
