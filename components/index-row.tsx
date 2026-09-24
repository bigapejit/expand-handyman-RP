import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// One row of a console index — Sites, Customers, a Customer's own Sites —
// and the empty state that stands in for the list. A title, a line under
// it, and the single hint someone scanning the list would act on, in the same
// place on every page so the eye lands where it did last time.
export function IndexRow({
  href,
  title,
  subtitle,
  hint,
  struck = false,
}: {
  href: string;
  title: string;
  subtitle: ReactNode;
  // A node rather than a string: the Customers index's hint is a Deal's Stage
  // chip and its next-up line (issue #320), which no string carries.
  hint: ReactNode;
  // A row still listed but no longer standing, as a void invoice is.
  struck?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate font-medium text-slate-900",
              struck && "text-slate-500 line-through",
            )}
          >
            {title}
          </p>
          <p className="truncate text-sm text-slate-500">{subtitle}</p>
          {/* A phone keeps the hint as a third line rather than
              losing it, since it is the one thing the row says to act on. */}
          <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-500 sm:hidden">
            {hint}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-sm text-slate-500 sm:flex">
          {hint}
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
      </Link>
    </li>
  );
}

export function IndexEmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-slate-50 text-center">
      <div className="px-6">
        <Icon className="mx-auto size-7 text-slate-400" />
        <h2 className="mt-3 font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{children}</p>
      </div>
    </div>
  );
}
