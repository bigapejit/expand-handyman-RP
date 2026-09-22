"use client";

// PROTOTYPE (wayfinder ticket #21): the owner gate lifted out of the old
// staff-shell.tsx, now rendered inside FRSG's shell.
import { useConvexAuth, useQuery } from "convex/react";
import { LoaderCircle, LockKeyhole } from "lucide-react";

import { api } from "@/convex/_generated/api";

export function OwnerGate({ children }: { children: React.ReactNode }) {
  const auth = useConvexAuth();
  const access = useQuery(api.documents.access, auth.isAuthenticated ? {} : "skip");

  if (auth.isLoading || access === undefined) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!access.owner) {
    return (
      <div className="mx-auto max-w-md p-12 text-center">
        <LockKeyhole className="mx-auto mb-4" />
        <h1 className="text-xl font-semibold">Owner access only</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Sign in with your authorized Expand Handyman account to open this workspace.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
