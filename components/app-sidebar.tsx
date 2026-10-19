"use client";

import { ChevronDown, Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import {
  isNavActive,
  morePages,
  navigation,
  Quiet,
  useUnreadLeads,
} from "@/components/nav-items";
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
  // PROTOTYPE (proposals-first): More starts folded unless the owner is on
  // one of its pages.
  const onMorePage = morePages.some((page) => isNavActive(pathname, page.href));
  const [moreOpen, setMoreOpen] = useState(false);
  const showMore = moreOpen || onMorePage;

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
                    className="h-10 text-[15px] md:h-9"
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
        <SidebarGroup className="mt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-9 text-slate-500"
                  aria-expanded={showMore}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <Ellipsis aria-hidden />
                  <span>More</span>
                  <ChevronDown
                    aria-hidden
                    className={`ml-auto transition-transform ${showMore ? "rotate-180" : ""}`}
                  />
                </SidebarMenuButton>
              </SidebarMenuItem>
              {showMore
                ? morePages.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        className="h-9 pl-4 text-slate-600"
                        isActive={isNavActive(pathname, item.href)}
                        render={
                          <Link
                            href={item.href}
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <item.icon aria-hidden />
                            <span>{item.title}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  ))
                : null}
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
