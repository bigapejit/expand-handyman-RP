"use client";

import "@/app/paper-print.css";
import "@/app/proposal-paper.css";
import "@/app/invoice-paper.css";

import { useAction, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { InvoicePaper } from "@/components/invoice-paper";
import { LinkNotLive } from "@/components/link-not-live";
import { PaperFrame, PaperLoading, PaperTopWithDownload } from "@/components/paper-screen";
import { PayBar, payBarShows } from "@/components/pay-bar";
import { api } from "@/convex/_generated/api";
import { invoiceLinkStrip, invoicePaperState, invoicePaperTitle } from "@/lib/invoice-paper";

// The customer reading a sent or void invoice through its **Invoice link**
// (CONTEXT.md): the invoice paper under the paper screen's top bar, and once
// it is paid or void a sentence under the bar saying so, as a decided
// proposal's link does, and Download for its PDF copy at the bar's end. While
// the invoice is owed, the pay bar sits under the paper (**Pay now**,
// components/pay-bar.tsx). Nothing is signed and nothing is logged, so there
// is no open to report and no heartbeat, and a Download or a press of Pay is
// never recorded. The page follows the invoice live, and a link that stops
// opening it says so.
export function InvoiceLinkPage({ token }: { token: string }) {
  const page = useQuery(api.invoiceLinks.page, { token });
  const openOnArrival = useArrival(token);
  if (page === undefined) return <PaperLoading />;
  if (page === null) return <LinkNotLive what="invoice" />;
  const { paper } = page;
  return (
    <PaperFrame
      top={
        <PaperTopWithDownload
          title={invoicePaperTitle(paper)}
          source={{ invoiceToken: token }}
          state={invoicePaperState(paper)}
          strip={invoiceLinkStrip(paper.stamp)}
        />
      }
      bar={
        payBarShows(page) ? (
          <PayBar token={token} page={page} openOnArrival={openOnArrival} />
        ) : undefined
      }
    >
      <InvoicePaper invoice={paper} />
    </PaperFrame>
  );
}

// What the address brought with it, read once as the page arrives and then
// taken off it, so a reload or a copied address never repeats it.
//
// `?session=` is the customer back from Stripe's page (the success return):
// the session is applied once, through the same mutation as the webhook, so
// the paper is right whether or not the webhook has landed yet. The paper
// follows the query live, so nothing waits on the answer, and a failure is
// only logged: the webhook still records the payment.
//
// `?pay=1` is the deposit button on a just-signed proposal: the Pay sheet
// opens on arrival. Answered with whether it asked.
function useArrival(token: string): boolean {
  const params = useSearchParams();
  const sessionId = params.get("session");
  const [openOnArrival] = useState(() => params.get("pay") === "1");
  const applyReturn = useAction(api.stripePayments.applyCheckoutReturn);
  const returned = useRef(false);

  useEffect(() => {
    if (openOnArrival) dropFromAddress("pay");
  }, [openOnArrival]);

  useEffect(() => {
    if (!sessionId || returned.current) return;
    returned.current = true;
    void applyReturn({ token, sessionId })
      .catch((error: unknown) => {
        console.error("The payment could not be read back from Stripe.", error);
      })
      .finally(() => dropFromAddress("session"));
  }, [applyReturn, sessionId, token]);

  return openOnArrival;
}

// The address without one of its query parameters, in place, with no
// reload and no new history entry.
function dropFromAddress(param: string): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(param)) return;
  url.searchParams.delete(param);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
