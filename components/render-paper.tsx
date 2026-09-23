"use client";

import { useQuery } from "convex/react";

import { LinkNotLive } from "@/components/link-not-live";
import { PaperLoading, PaperScreen } from "@/components/paper-screen";
import type { PaperFooter } from "@/components/proposal-paper";
import { api } from "@/convex/_generated/api";

// The paper under a render pass, for the PDF renderer: exactly what the
// customer's link shows, with no sign bar, no Download and nothing reported
// anywhere (convex/proposalPdf.ts, `paper`). A pass that has expired, been
// used, or outlived its proposal's state opens nothing.
export function RenderPaper({ pass, footer }: { pass: string; footer: PaperFooter }) {
  const paper = useQuery(api.proposalPdf.paper, { pass });
  if (paper === undefined) return <PaperLoading />;
  if (paper === null) return <LinkNotLive what="proposal" />;
  return <PaperScreen paper={paper} footer={footer} />;
}
