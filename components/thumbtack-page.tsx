"use client";

import { useMutation, useQuery } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LeadPanel, LeadPanelParam, type BoardLead } from "@/components/lead-panel";
import { useSidePanel } from "@/components/side-panel";
import { ThumbtackBoard } from "@/components/thumbtack-board";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Stage } from "@/lib/thumbtack";
import { errorMessage } from "@/lib/utils";

// The Thumbtack page's live half: the board from Convex, the open lead in the
// URL, and the two things the owner does here, opening a lead and moving it.
export function ThumbtackBoardPage() {
  const leads = useQuery(api.leads.board);
  const openLead = useMutation(api.leads.open);
  const setStage = useMutation(api.leads.setStage);
  const { openId, open, close } = useSidePanel(LeadPanelParam);
  const [error, setError] = useState("");

  // A link naming a lead that is not there just shows the board.
  const lead = leads?.find((row) => row._id === openId);

  // Opening a lead is reading it, which clears **Unread**. Once per open, and
  // again if the customer writes while the panel is up, since the owner is
  // looking at it.
  const recorded = useRef<string | null>(null);
  const leadId = lead?._id;
  const lastCustomerMessageAt = lead?.lastCustomerMessageAt;
  useEffect(() => {
    if (!leadId) {
      recorded.current = null;
      return;
    }
    const key = `${leadId}:${lastCustomerMessageAt ?? 0}`;
    if (recorded.current === key) return;
    recorded.current = key;
    openLead({ leadId }).catch((err: unknown) => setError(errorMessage(err)));
  }, [leadId, lastCustomerMessageAt, openLead]);

  const move = (id: Id<"leads">, stage: Stage) => {
    setError("");
    setStage({ leadId: id, stage }).catch((err: unknown) => setError(errorMessage(err)));
  };

  if (leads === undefined) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
        <LoaderCircle aria-label="Loading leads" className="size-6 animate-spin text-slate-500" />
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
      <ThumbtackBoard leads={leads} onOpen={open} onSetStage={move} />
      {lead ? (
        <LiveLeadPanel key={lead._id} lead={lead} onSetStage={move} onClose={close} />
      ) : null}
    </>
  );
}

// The panel with its chat, read only while it is open: the board carries just
// each lead's last message.
function LiveLeadPanel({
  lead,
  onSetStage,
  onClose,
}: {
  lead: BoardLead;
  onSetStage: (leadId: Id<"leads">, stage: Stage) => void;
  onClose: () => void;
}) {
  const thread = useQuery(api.leads.thread, { leadId: lead._id });
  return (
    <LeadPanel
      lead={lead}
      messages={thread === undefined ? undefined : (thread ?? [])}
      onSetStage={onSetStage}
      onClose={onClose}
    />
  );
}
