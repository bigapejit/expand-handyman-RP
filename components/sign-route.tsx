"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";

import { LinkNotLive } from "@/components/link-not-live";
import { SigningPage } from "@/components/signing-page";
import { api } from "@/convex/_generated/api";

// The proposal page brings the paper's own stylesheets, including its print
// rules, so it loads only for a proposal's link and a document's link prints
// exactly as it always has.
const ProposalSigningPage = dynamic(
  () => import("@/components/proposal-signing-page").then((m) => m.ProposalSigningPage),
  { loading: () => <SignLoading /> },
);

// `/sign/<token>`: one address for every signing link, whether it opens a
// document or a proposal (CONTEXT.md, **Signing link**). A token naming
// nothing goes to the document page, which has always answered one with
// "This link is no longer live".
export function SignRoute({ token }: { token: string }) {
  const kind = useQuery(api.signingLinks.resolve, { token });
  if (kind === undefined) return <SignLoading />;
  if (kind === "proposal") return <ProposalSigningPage token={token} />;
  if (kind === "ended") return <LinkNotLive what="proposal" />;
  return <SigningPage token={token} />;
}

// The signing screen's top bar over an empty backdrop, the way the document
// page draws itself while its file loads, so nothing jumps whichever page
// follows. Nothing here needs the paper's stylesheets.
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
