"use client";

import { useQuery } from "convex/react";
import { ChevronRight, KeyRound, LoaderCircle, MapPin, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CustomerDialog } from "@/components/customer-dialog";
import { CustomerDocuments } from "@/components/customer-documents";
import { HubEmpty, HubLoading, HubSection } from "@/components/customer-hub-shell";
import { SiteDialog } from "@/components/site-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCustomer } from "@/hooks/use-customers";
import { displayPhone } from "@/lib/customer";

// PROTOTYPE (#90): the thin customer page issue #88 decided. No tabs: who
// they are, their sites as cards that open the site page, then Documents.
export function ThinCustomerPage({ customerId }: { customerId: string }) {
  const id = customerId as Id<"customers">;
  const customer = useCustomer(customerId);
  const sites = useQuery(api.sites.forCustomer, { customerId: id });
  const [editing, setEditing] = useState(false);
  const [addingSite, setAddingSite] = useState(false);

  if (customer === undefined) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading customer" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (customer === null) return <p className="text-sm text-slate-500">No such customer.</p>;

  const contact = [customer.email, displayPhone(customer.phone)].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">{contact}</p>
        </div>
        <Button variant="outline" size="lg" onClick={() => setEditing(true)}>
          <Pencil data-icon="inline-start" aria-hidden /> Edit
        </Button>
      </header>

      <HubSection
        title="Sites"
        description="Where the work happens. Everything priced lives on the site."
        action={
          <Button variant="outline" size="lg" onClick={() => setAddingSite(true)}>
            <Plus data-icon="inline-start" aria-hidden /> New site
          </Button>
        }
      >
        {sites === undefined ? (
          <HubLoading label="Loading sites" />
        ) : sites.length === 0 ? (
          <HubEmpty>No sites yet. Add one before pricing any work.</HubEmpty>
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2">
            {sites.map((site) => (
              <li key={site._id}>
                <Link
                  href={`/sites/${site._id}`}
                  className="flex h-full items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-slate-50"
                >
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-medium text-slate-900">
                      {[site.addressLine1, site.addressLine2].filter(Boolean).join(", ")}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {[site.city, site.region].filter(Boolean).join(", ")}
                    </span>
                    {site.accessNotes ? (
                      <span className="flex items-start gap-1 text-xs text-slate-600">
                        <KeyRound aria-hidden className="mt-0.5 size-3 shrink-0 text-slate-400" />
                        {site.accessNotes}
                      </span>
                    ) : null}
                    <span className="block text-xs text-slate-500">
                      {site.proposalCount === 0
                        ? "No proposals"
                        : site.proposalCount === 1
                          ? "1 proposal"
                          : `${site.proposalCount} proposals`}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </HubSection>

      <CustomerDocuments customerId={customerId} />

      {editing ? <CustomerDialog customer={customer} onClose={() => setEditing(false)} /> : null}
      {addingSite ? <SiteDialog customerId={id} onClose={() => setAddingSite(false)} /> : null}
    </div>
  );
}
