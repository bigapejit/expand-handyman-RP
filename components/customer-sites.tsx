"use client";

import { useMutation, useQuery } from "convex/react";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { HubEmpty, HubLoading, HubSection } from "@/components/customer-hub-shell";
import { SiteDialog } from "@/components/site-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/utils";

// The customer's sites: added, corrected and deleted here, since sites have no
// page of their own.
export function CustomerSites({ customerId }: { customerId: string }) {
  const id = customerId as Id<"customers">;
  const sites = useQuery(api.sites.forCustomer, { customerId: id });
  const remove = useMutation(api.sites.remove);
  const [editing, setEditing] = useState<Doc<"sites"> | "new" | null>(null);
  const [deleting, setDeleting] = useState<Doc<"sites"> | null>(null);
  const [error, setError] = useState("");

  return (
    <HubSection
      title="Sites"
      description="Where the work happens. Every proposal is for one site."
      action={
        <Button variant="outline" size="lg" onClick={() => setEditing("new")}>
          <Plus data-icon="inline-start" aria-hidden /> Add site
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="border-b px-5 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {sites === undefined ? (
        <HubLoading label="Loading sites" />
      ) : sites.length === 0 ? (
        <HubEmpty>No sites yet. Add one before writing a proposal.</HubEmpty>
      ) : (
        <ul>
          {sites.map((site) => (
            <li key={site._id} className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0">
              <MapPin aria-hidden className="size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{site.name}</span>
                <span className="block truncate text-sm text-slate-500">{site.address}</span>
                {site.accessNotes ? (
                  <span className="block truncate text-xs text-slate-500">{site.accessNotes}</span>
                ) : null}
              </span>
              <span className="hidden shrink-0 text-sm text-slate-500 sm:block">
                {site.proposalCount === 0
                  ? "No proposals"
                  : site.proposalCount === 1
                    ? "1 proposal"
                    : `${site.proposalCount} proposals`}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${site.name}`}
                onClick={() => setEditing(site)}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${site.name}`}
                disabled={site.proposalCount > 0}
                title={
                  site.proposalCount > 0
                    ? "A site with proposals can't be deleted."
                    : undefined
                }
                onClick={() => {
                  setError("");
                  setDeleting(site);
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <SiteDialog
          customerId={id}
          site={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => open || setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The site has no proposals. To move it to another customer, delete it
              here and add it again there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep site</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const site = deleting;
                setDeleting(null);
                if (!site) return;
                try {
                  await remove({ siteId: site._id });
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
            >
              Delete site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </HubSection>
  );
}
