"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { openPanelId, panelHref } from "@/lib/side-panel";

// The shell every Proposals-arc list edits through: the tab stays a list, and
// the row being written slides in from the right over it, wide enough for a
// table (issue #195). Which row is open is a search parameter and nothing
// else, so a reload and a copied link reopen the same panel, and Back closes
// it. Solutions (#207) uses this first; Proposals (#208) uses the same panel
// and the same field furniture rather than a second set of its own.

// The open row, and the two things that can happen to it. The URL is updated
// through the History API rather than a router navigation, which is what keeps
// opening a row instant: the list behind the panel is never re-fetched, and
// `useSearchParams` still sees the change.
export function useSidePanel(param: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const show = useCallback(
    (openId: string | null) => {
      // Pushed, not replaced: opening a row is somewhere the author went, and
      // Back is the fastest way out of a panel.
      window.history.pushState(null, "", panelHref(pathname, search, param, openId));
    },
    [pathname, search, param],
  );

  return {
    openId: openPanelId(search, param),
    open: useCallback((id: string) => show(id), [show]),
    close: useCallback(() => show(null), [show]),
  };
}

// Rendered only while a row is open, so the caller's `null` is the closed
// state. Escape, the close button, and a click outside all mean the same
// thing, and all of them go through the URL.
export function SidePanel({
  title,
  description,
  onClose,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (open) return;
        // Every field in a panel commits when it is left, and closing the
        // panel unmounts it without React ever firing that blur. Clicking the
        // close button or the backdrop blurs first and is safe; Escape and
        // Back are not, so the focused field is sent away by hand and the last
        // thing typed is kept rather than silently dropped.
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        onClose();
      }}
    >
      {/* Expand: full width on a phone, where the sheet's stock 75% cut
          solution names short and pushed the tax row onto its label. */}
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b px-6 py-5 pr-14">
          <SheetTitle>{title}</SheetTitle>
          {description === undefined ? null : (
            <SheetDescription>{description}</SheetDescription>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

// The heading over one field. Every panel in the arc labels its fields the
// same way, so the styling lives here with the panel rather than being copied
// into each tab that opens one.
const FieldLabelClass =
  "block text-xs font-medium tracking-wide text-slate-500 uppercase";

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className={FieldLabelClass}>
      {children}
    </label>
  );
}

// The same heading over something that is not one field: a set of chips, a
// table, a list of Solutions, a toggle with a sentence under it.
export function FieldHeading({ children }: { children: ReactNode }) {
  return <p className={FieldLabelClass}>{children}</p>;
}
