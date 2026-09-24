"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { LoaderCircle, LockKeyhole } from "lucide-react";

import { api } from "@/convex/_generated/api";

// Signed in is not enough: only the owner's account opens the staff console.
// Convex refuses everyone else anyway; this says so instead of showing
// half-loaded pages.
export function OwnerGate({ children }: { children: React.ReactNode }) {
  const auth = useConvexAuth();
  const access = useQuery(api.auth.access, auth.isAuthenticated ? {} : "skip");

  if (auth.isLoading || (auth.isAuthenticated && access === undefined)) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!access?.owner) {
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
