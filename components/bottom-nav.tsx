"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  isNavActive,
  isOnMorePage,
  morePages,
  navigation,
  Quiet,
  useUnreadLeads,
} from "@/components/nav-items";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// The phone's way between pages: the sidebar's three places as a tab bar
// along the bottom, where a thumb already is, and a fourth tab, More, that
// opens a sheet from the bottom with the pages visited least. Under md only;
// the desktop keeps the sidebar. Sheets and dialogs (z-50) open over it.
export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const onMorePage = isOnMorePage(pathname);

  return (
    <nav
      aria-label="Pages"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {navigation.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex h-14 flex-col items-center justify-center gap-1"
              >
                <span className="relative">
                  <item.icon
                    aria-hidden
                    className={cn("size-5", active ? "text-primary" : "text-slate-500")}
                  />
                  {item.href === "/thumbtack" ? (
                    <Quiet>
                      <UnreadDot />
                    </Quiet>
                  ) : null}
                </span>
                <TabLabel active={active}>{item.title}</TabLabel>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-current={onMorePage ? "page" : undefined}
            className="flex h-14 w-full flex-col items-center justify-center gap-1"
          >
            <Ellipsis
              aria-hidden
              className={cn("size-5", onMorePage ? "text-primary" : "text-slate-500")}
            />
            <TabLabel active={onMorePage}>More</TabLabel>
          </button>
        </li>
      </ul>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <ul className="grid gap-1 px-2">
            {morePages.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={isNavActive(pathname, page.href) ? "page" : undefined}
                  className="flex h-12 items-center gap-3 rounded-xl px-3 text-base text-slate-800 hover:bg-slate-50 aria-[current=page]:bg-slate-100 aria-[current=page]:font-medium"
                >
                  <page.icon aria-hidden className="size-5 text-slate-500" />
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

// The amber carries the active tab on the icon; a label this small reads in
// amber only faintly, so it darkens instead.
function TabLabel({ active, children }: { active: boolean; children: string }) {
  return (
    <span
      className={cn(
        "text-[11px] leading-none whitespace-nowrap",
        active ? "font-semibold text-slate-900" : "text-slate-500",
      )}
    >
      {children}
    </span>
  );
}

// The sidebar's unread count, pinned to the corner of the Leads icon.
function UnreadDot() {
  const unread = useUnreadLeads();
  if (!unread) return null;
  return (
    <span className="absolute -top-1.5 left-3 grid h-4 min-w-4 place-items-center rounded-full bg-sky-500 px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-white">
      {unread}
      <span className="sr-only"> unread</span>
    </span>
  );
}
