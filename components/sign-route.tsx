"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";

import { LinkNotLive } from "@/components/link-not-live";
import { api } from "@/convex/_generated/api";

// The proposal page brings the paper's own stylesheets, including its print
// rules, so it loads only for a proposal's link.
const ProposalSigningPage = dynamic(
  () => import("@/components/proposal-signing-page").then((m) => m.ProposalSigningPage),
  { loading: () => <SignLoading /> },
);

// The invoice paper, loaded the same way for the same reason.
const InvoiceLinkPage = dynamic(
  () => import("@/components/invoice-link-page").then((m) => m.InvoiceLinkPage),
  { loading: () => <SignLoading /> },
);

// `/sign/<token>`: one address for every link Expand sends, whether it opens a
// proposal (CONTEXT.md, **Signing link**) or an invoice (**Invoice link**). A
// token naming nothing is answered like an ended link: "This link is no
// longer live".
export function SignRoute({ token }: { token: string }) {
  const kind = useQuery(api.signingLinks.resolve, { token });
  if (kind === undefined) return <SignLoading />;
  if (kind === "proposal") return <ProposalSigningPage token={token} />;
  if (kind === "invoice") return <InvoiceLinkPage token={token} />;
  return <LinkNotLive what="proposal" />;
}

// The signing screen's top bar over an empty backdrop while the page finds
// out what the link opens, so nothing jumps whichever page follows. Nothing
// here needs the paper's stylesheets.
function SignLoading() {
  return (
    <div className="paper-screen paper-screen-signing">
      <header className="paper-top">
        <div className="paper-top-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="paper-brand" src="/logo.svg" alt="Expand Handyman" />
          <span className="paper-title" />
        </div>
      </header>
      <main className="paper-sheets">
        <div className="paper-pdf-loading">Loading…</div>
      </main>
    </div>
  );
}
