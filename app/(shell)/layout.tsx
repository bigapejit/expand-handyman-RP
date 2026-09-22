// PROTOTYPE (wayfinder ticket #21): FRSG's (shell)/layout.tsx verbatim, plus
// Expand's owner gate, which FRSG has no equivalent of.
import { auth } from "@clerk/nextjs/server";

import { AppSidebar } from "@/components/app-sidebar";
import { OwnerGate } from "@/components/owner-gate";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default async function ShellLayout({ children }: LayoutProps<"/">) {
  await auth.protect();
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
          <OwnerGate>{children}</OwnerGate>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
