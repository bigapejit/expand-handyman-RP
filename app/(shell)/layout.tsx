import { auth } from "@clerk/nextjs/server";

import { AccountMenu } from "@/components/account-menu";
import { AppSidebar } from "@/components/app-sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { Brand } from "@/components/brand";
import { OwnerGate } from "@/components/owner-gate";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

// FRSG's shell. Every staff page sits under it, so signing in is checked here
// once and the owner gate stands in front of every page's content.
export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await auth.protect();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          {/* Expand: a phone gets about by the bottom tab bar, so its header
              carries the mark and the account instead of the sidebar's
              trigger. */}
          <div className="flex flex-1 items-center justify-between md:hidden">
            <Brand />
            <AccountMenu variant="monogram" />
          </div>
          <SidebarTrigger className="max-md:hidden" />
          <Separator orientation="vertical" className="mr-1 h-4 max-md:hidden" />
          <span className="text-sm text-muted-foreground max-md:hidden">Staff console</span>
        </header>
        {/* Expand: a phone's 412px cannot spare 32px a side, and its last row
            has to clear the tab bar. */}
        <div className="flex flex-1 flex-col gap-6 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-8">
          <OwnerGate>{children}</OwnerGate>
        </div>
        <BottomNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
