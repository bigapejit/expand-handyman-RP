"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { PaperLoading, PaperScreen } from "@/components/paper-screen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// The staff paper: the owner reading a proposal as its customer will, from
// "View paper" in the proposal panel. A draft is laid out as if sent now, with
// the owner as its Estimator (proposals.paper). Nothing here reports a view:
// the owner checking their own work is not the customer's interest. A sent or
// approved proposal offers its PDF copy in the top bar.
export function StaffPaper({ proposalId }: { proposalId: Id<"proposals"> }) {
  const paper = useQuery(api.proposals.paper, { proposalId });
  // A draft is laid out as if sent the moment the page opened.
  const [openedAt] = useState(() => Date.now());

  if (paper === undefined) return <PaperLoading />;
  if (paper === null) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          This proposal&rsquo;s paper isn&rsquo;t available here.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the proposal from the customer&rsquo;s Proposals tab.
        </p>
      </div>
    );
  }

  return (
    <PaperScreen
      paper={{ ...paper, sentAt: paper.sentAt ?? openedAt }}
      download={{ proposalId }}
      strip={
        paper.state === "draft"
          ? { tone: "note", body: draftStrip(paper.unpricedSolutions) }
          : undefined
      }
    />
  );
}

// A draft may hold solutions not yet priced, and its total leaves them out.
// The paper can't say so without saying it to the customer, so the strip does.
function draftStrip(unpricedSolutions: number): string {
  if (unpricedSolutions === 0) return "Preview of a Draft";
  return unpricedSolutions === 1
    ? "Preview of a Draft. 1 solution has no price yet and isn't in the total."
    : `Preview of a Draft. ${unpricedSolutions} solutions have no price yet and aren't in the total.`;
}
