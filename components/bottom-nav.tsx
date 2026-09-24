"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavActive, navigation, Quiet, useUnreadLeads } from "@/components/nav-items";
import { cn } from "@/lib/utils";

// The phone's way between pages: the sidebar's list as a tab bar along the
// bottom, where a thumb already is. Under md only; the desktop keeps the
// sidebar. Sheets and dialogs (z-50) open over it.
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Pages"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-6">
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
                {/* The amber carries the active tab on the icon; a label this
                    small reads in amber only faintly, so it darkens instead. */}
                <span
                  className={cn(
                    "text-[11px] leading-none whitespace-nowrap",
                    active ? "font-semibold text-slate-900" : "text-slate-500",
                  )}
                >
                  {item.title}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// The sidebar's unread count, pinned to the corner of the Thumbtack icon.
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
