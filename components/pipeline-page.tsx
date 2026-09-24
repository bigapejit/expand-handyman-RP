"use client";

import { useMutation, useQuery } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { DealDialog } from "@/components/deal-dialog";
import { DealPanel, DealPanelParam } from "@/components/deal-panel";
import { PipelineBoard } from "@/components/pipeline-board";
import { useSidePanel } from "@/components/side-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Stage } from "@/lib/pipeline";
import { errorMessage } from "@/lib/utils";

// The **Pipeline** page's live half: the board from Convex, the open deal in
// the URL, and what the owner does here: add a deal, open one, move one.
export function PipelinePage() {
  const deals = useQuery(api.deals.board);
  const openDeal = useMutation(api.deals.open);
  const setStage = useMutation(api.deals.setStage);
  const { openId, open, close } = useSidePanel(DealPanelParam);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  // A link naming a deal that is not there just shows the board.
  const deal = deals?.find((row) => row._id === openId);

  // Opening a Thumbtack deal is reading its lead, which clears **Unread**; and
  // again if the customer writes while the panel is up, since the owner is
  // looking at it.
  const dealId = deal?._id;
  const unread = deal?.lead?.unread ?? false;
  useEffect(() => {
    if (!dealId || !unread) return;
    openDeal({ dealId }).catch((err: unknown) => setError(errorMessage(err)));
  }, [dealId, unread, openDeal]);

  const move = (id: Id<"deals">, stage: Stage) => {
    setError("");
    setStage({ dealId: id, stage }).catch((err: unknown) => setError(errorMessage(err)));
  };

  if (deals === undefined) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
        <LoaderCircle aria-label="Loading deals" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <PipelineBoard deals={deals} onOpen={open} onSetStage={move} onNew={() => setAdding(true)} />
      {deal ? <DealPanel key={deal._id} deal={deal} onSetStage={move} onClose={close} /> : null}
      {adding ? <DealDialog onClose={() => setAdding(false)} onCreated={open} /> : null}
    </>
  );
}
