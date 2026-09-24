import { auth } from "@clerk/nextjs/server";

import { AppSidebar } from "@/components/app-sidebar";
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
          {/* A thumb-sized target on a phone, where it is the only way to
              the other pages; the desktop's stays compact. */}
          <SidebarTrigger className="-ml-2 max-md:size-10 md:ml-0" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm text-muted-foreground">Staff console</span>
        </header>
        {/* A phone's 412px cannot spare 32px a side. */}
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <OwnerGate>{children}</OwnerGate>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
