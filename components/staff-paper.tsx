"use client";

import { useQuery } from "convex/react";

import { PaperLoading, PaperScreen } from "@/components/paper-screen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// The staff paper: the owner reading a proposal as its customer will, from
// "View paper" in the proposal panel. A draft is laid out as if sent now, with
// the owner as its Estimator (proposals.paper). Nothing here reports a view:
// the owner checking their own work is not the customer's interest.
export function StaffPaper({ proposalId }: { proposalId: Id<"proposals"> }) {
  const paper = useQuery(api.proposals.paper, { proposalId });

  if (paper === undefined) return <PaperLoading />;
  if (paper === null) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">This proposal has no paper to show.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been deleted. Open it again from the customer&rsquo;s Proposals tab.
        </p>
      </div>
    );
  }

  return (
    <PaperScreen
      paper={paper}
      strip={paper.state === "draft" ? { tone: "note", body: "Preview of a Draft" } : undefined}
    />
  );
}
