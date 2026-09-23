"use client";

import "@/app/paper-print.css";
import "@/app/proposal-paper.css";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";

import { LinkNotLive } from "@/components/link-not-live";
import { PaperLoading, PaperScreen } from "@/components/paper-screen";
import { useViewHeartbeat } from "@/components/view-heartbeat";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// The customer reading a sent proposal through its signing link: the paper
// exactly as Send froze it. Approve and Decline arrive with the sign bar in a
// later change; until then the page only reads.
//
// Every open is logged once the paper has arrived, as a view or, when the
// owner is signed in, as an owner preview (ADR 0001), and the heartbeat keeps
// it counting while the tab is visible. A link withdrawn or replaced while the
// page is open turns into "This link is no longer live" at once, because the
// paper is a live query.
export function ProposalSigningPage({ token }: { token: string }) {
  const paper = useQuery(api.signingLinks.paper, { token });
  const opened = useMutation(api.signingLinks.opened);
  const seen = useMutation(api.signingLinks.seen);
  const view = useRef<Id<"proposalViews"> | null>(null);
  const logged = useRef(false);
  const arrived = paper !== undefined && paper !== null;

  useEffect(() => {
    if (!arrived || logged.current) return;
    logged.current = true;
    void opened({ token, userAgent: navigator.userAgent })
      .then((id) => {
        view.current = id;
      })
      .catch(() => {});
  }, [arrived, opened, token]);
  useViewHeartbeat(view, token, seen, "proposal");

  if (paper === undefined) return <PaperLoading />;
  if (paper === null) return <LinkNotLive what="proposal" />;
  return <PaperScreen paper={paper} />;
}
