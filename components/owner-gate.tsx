"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect } from "react";

import { api } from "@/convex/_generated/api";

// Signed in is not enough: only a **Staff member**'s account opens the staff
// console. Convex refuses everyone else anyway; this says so instead of
// showing half-loaded pages.
export function OwnerGate({ children }: { children: React.ReactNode }) {
  const auth = useConvexAuth();
  const access = useQuery(api.auth.access, auth.isAuthenticated ? {} : "skip");
  const seen = useMutation(api.staff.seen);
  const owner = access?.owner === true;

  // Once per page load: the Staff page's "Last seen", and the first sign-in
  // that moves an invitee to Has access. Never worth an error on screen.
  useEffect(() => {
    if (auth.isAuthenticated && owner) seen({}).catch(() => {});
  }, [auth.isAuthenticated, owner, seen]);

  if (auth.isLoading || (auth.isAuthenticated && access === undefined)) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!owner) {
    return (
      <div className="mx-auto max-w-md p-12 text-center">
        <LockKeyhole className="mx-auto mb-4" />
        <h1 className="text-xl font-semibold">Invite only</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This console is for Expand Handyman staff. Ask Andrew for an invite, then sign in
          with the email it was sent to.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
