// PROTOTYPE review page, delete before merge. The real ThumbtackBoard and
// LeadPanel on fixture data, in React memory, inside an ungated copy of the
// staff shell, so a reviewer can see them without a Clerk sign-in. No
// auth.protect(), no OwnerGate and no Convex reads on purpose.
"use client";

import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { LeadPanel, LeadPanelParam } from "@/components/lead-panel";
import { PageHeader } from "@/components/page-header";
import { useSidePanel } from "@/components/side-panel";
import { ThumbtackBoard } from "@/components/thumbtack-board";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { Id } from "@/convex/_generated/dataModel";
import { prototypeBoard, prototypeThreads } from "@/lib/prototype-thumbtack-fixtures";
import type { Stage } from "@/lib/thumbtack";

export default function PrototypeThumbtackBoardPage() {
  const [leads, setLeads] = useState(prototypeBoard);
  const { openId, open, close } = useSidePanel(LeadPanelParam);
  const lead = leads.find((row) => row._id === openId);

  // Opening a lead is reading it: the unread dot goes, as `leads.open` does.
  useEffect(() => {
    if (!openId) return;
    setLeads((current) =>
      current.map((row) =>
        row._id === openId && row.unread ? { ...row, openedAt: Date.now(), unread: false } : row,
      ),
    );
  }, [openId]);

  const setStage = (leadId: Id<"leads">, stage: Stage) =>
    setLeads((current) =>
      current.map((row) =>
        row._id === leadId ? { ...row, stage, stageChangedAt: Date.now() } : row,
      ),
    );

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm text-muted-foreground">Staff console</span>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-8">
          <div className="space-y-6">
            <PageHeader
              title="Thumbtack"
              description="Leads from Thumbtack, newest first. Chat is read-only here; reply on Thumbtack."
            />
            <ThumbtackBoard leads={leads} onOpen={open} />
            {lead ? (
              <LeadPanel
                key={lead._id}
                lead={lead}
                messages={prototypeThreads[lead._id] ?? []}
                onSetStage={setStage}
                onClose={close}
              />
            ) : null}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
