"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { isNavActive, navigation, Quiet, useUnreadLeads } from "@/components/nav-items";
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
                    // The phone's sheet is tapped, not clicked.
                    className="h-10 md:h-8"
                    isActive={isNavActive(pathname, item.href)}
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
                  {item.href === "/thumbtack" ? (
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
        <AccountMenu variant="card" />
      </SidebarFooter>
    </Sidebar>
  );
}

// Unread Thumbtack leads on the nav item, nothing until they are known or
// while there are none.
function UnreadBadge() {
  const unread = useUnreadLeads();
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
