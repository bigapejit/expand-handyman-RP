"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeft,
  ChevronRight,
  KeyRound,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CustomerDialog } from "@/components/customer-dialog";
import { CustomerThumbtack } from "@/components/customer-thumbtack";
import { HubEmpty, HubLoading, HubSection } from "@/components/hub-section";
import { SiteDialog } from "@/components/site-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCustomer } from "@/hooks/use-customers";
import { displayPhone } from "@/lib/customer";

type CustomerSite = FunctionReturnType<typeof api.sites.forCustomer>[number];

// The Customer page, thin: who they are, their sites as cards that open the
// Site page, where the work lives, then their Thumbtack leads. No tabs;
// correcting or deleting a site happens on the site's own page.
export function CustomerPage({ customerId }: { customerId: string }) {
  const customer = useCustomer(customerId);
  const [editing, setEditing] = useState(false);

  if (customer === undefined) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading customer" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (customer === null) return <CustomerNotFound />;

  // A number that came with a Thumbtack lead may be a relay that stops working.
  const phone =
    customer.phone && customer.phoneFrom === "thumbtack"
      ? `${displayPhone(customer.phone)} · Thumbtack number`
      : displayPhone(customer.phone);
  const contact = [customer.email, phone].filter(Boolean).join(" · ");

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
      <CustomerSites customerId={customer._id} />
      <CustomerThumbtack customerId={customer._id} />
      {editing ? (
        <CustomerDialog customer={customer} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

// Cards rather than rows: a customer has few sites, and the address needs the
// room. New site here already knows whose it is.
function CustomerSites({ customerId }: { customerId: Id<"customers"> }) {
  const sites = useQuery(api.sites.forCustomer, { customerId });
  const [adding, setAdding] = useState(false);

  return (
    <HubSection
      title="Sites"
      description="Where the work happens. Everything priced lives on the site."
      action={
        <Button variant="outline" size="lg" onClick={() => setAdding(true)}>
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
            <SiteCard key={site._id} site={site} />
          ))}
        </ul>
      )}
      {adding ? <SiteDialog customerId={customerId} onClose={() => setAdding(false)} /> : null}
    </HubSection>
  );
}

function SiteCard({ site }: { site: CustomerSite }) {
  return (
    <li>
      <Link
        href={`/sites/${site._id}`}
        className="flex h-full items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-slate-50"
      >
        <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block font-medium text-slate-900">{site.streetLine}</span>
          <span className="block text-sm text-slate-500">{site.cityLine}</span>
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
  );
}

function CustomerNotFound() {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-slate-50 text-center">
      <div className="px-6">
        <UserX className="mx-auto size-7 text-slate-400" />
        <h1 className="mt-3 font-semibold text-slate-900">No such customer</h1>
        <p className="mt-1 text-sm text-slate-500">
          This link names a customer that does not exist, or one that has since been removed.
        </p>
        <Link
          href="/customers"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to Customers
        </Link>
      </div>
    </div>
  );
}
