"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import {
  FileSignature,
  SquareKanban,
  LayoutDashboard,
  LogOut,
  MapPin,
  ReceiptText,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Component, useState, type ReactNode } from "react";

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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { api } from "@/convex/_generated/api";

const navigation = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  // Straight after the Dashboard: the Site is the page the owner works from.
  { title: "Sites", href: "/sites", icon: MapPin },
  { title: "Customers", href: "/customers", icon: Users },
  // PROTOTYPE: the Thumbtack page grown to every deal. /thumbtack still exists.
  { title: "Pipeline", href: "/pipeline", icon: SquareKanban },
  { title: "Proposals", href: "/proposals", icon: FileSignature },
  { title: "Invoices", href: "/invoices", icon: ReceiptText },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

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
                      <Link
                        href={item.href}
                        // The phone's sheet would otherwise stay over the page.
                        onClick={() => isMobile && setOpenMobile(false)}
                      >
                        <item.icon aria-hidden />
                        <span>{item.title}</span>
                      </Link>
                    }
                  />
                  {item.href === "/pipeline" ? (
                    <Quiet>
                      <UnreadBadge />
                    </Quiet>
                  ) : null}
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

// Unread Thumbtack leads on the nav item. The sidebar renders outside the
// owner gate and `unreadCount` throws for anyone but the owner, so it asks only
// once Convex knows the owner is signed in (the gate's own query, shared), and
// shows nothing until it hears back or while there are none.
function UnreadBadge() {
  const auth = useConvexAuth();
  const access = useQuery(api.auth.access, auth.isAuthenticated ? {} : "skip");
  const unread = useQuery(api.leads.unreadCount, access?.owner ? {} : "skip");
  if (!unread) return null;
  return (
    <SidebarMenuBadge
      aria-label={`${unread} unread`}
      className="rounded-full bg-sky-500 text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white"
    >
      {unread}
    </SidebarMenuBadge>
  );
}

// A badge is never worth the page: if its query fails (a deployment behind
// the app, say), the badge goes and the shell stays.
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
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
