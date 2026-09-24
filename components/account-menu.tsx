"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
import { useState } from "react";

import { Monogram } from "@/components/monogram";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";

// The account door, with Sign out and Clerk's profile modal behind it. The
// desktop sidebar shows it as FRSG's card, initials and name; the phone's
// header, which has no sidebar, as the initials alone.
export function AccountMenu({ variant }: { variant: "card" | "monogram" }) {
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
      {variant === "card" ? (
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
      ) : (
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Account: ${name}`}
              className="-mr-1 grid size-10 place-items-center rounded-full hover:bg-muted"
            />
          }
        >
          <Monogram name={name} size="md" />
        </PopoverTrigger>
      )}
      <PopoverContent
        side={variant === "card" ? "top" : "bottom"}
        align={variant === "card" ? "start" : "end"}
        sideOffset={8}
        className="w-60 gap-2"
      >
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
