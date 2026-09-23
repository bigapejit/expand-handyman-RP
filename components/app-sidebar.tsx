"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { FileSignature, FileText, LayoutDashboard, LogOut, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { Monogram } from "@/components/monogram";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navigation = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Proposals", href: "/proposals", icon: FileSignature },
  { title: "Documents", href: "/documents", icon: FileText },
] as const;

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href)
                    }
                    render={
                      <Link href={item.href}>
                        <item.icon aria-hidden />
                        <span>{item.title}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <AccountCard />
      </SidebarFooter>
    </Sidebar>
  );
}

// FRSG's sidebar card, keeping only the account door: the owner's initials and
// name, with Sign out and Clerk's profile modal behind them.
function AccountCard() {
  const { user } = useUser();
  const clerk = useClerk();
  const { isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Owner";

  // On a phone the sidebar is a sheet, and Clerk's modal would open behind it.
  function openAccount() {
    setOpen(false);
    if (isMobile) setOpenMobile(false);
    clerk.openUserProfile();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-sidebar-accent"
          />
        }
      >
        <Monogram name={name} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-tight">{name}</span>
          <span className="block truncate text-[11px] leading-tight text-slate-500">Owner</span>
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-60 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => void clerk.signOut({ redirectUrl: "/sign-in" })}
        >
          <LogOut data-icon="inline-start" aria-hidden />
          Sign out
        </Button>
        <Button size="sm" variant="outline" className="w-full" onClick={openAccount}>
          Manage account
        </Button>
      </PopoverContent>
    </Popover>
  );
}
