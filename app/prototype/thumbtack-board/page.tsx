// PROTOTYPE, delete before merge. An ungated copy of the staff shell around
// the Thumbtack board, so it can be screenshotted without a Clerk sign-in.
// No auth.protect() and no OwnerGate on purpose.

import { AppSidebar } from "@/components/app-sidebar";
import { PageHeader } from "@/components/page-header";
import { PrototypeThumbtackBoard } from "@/components/prototype-thumbtack-board";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function PrototypeThumbtackBoardPage() {
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
            <PrototypeThumbtackBoard />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
