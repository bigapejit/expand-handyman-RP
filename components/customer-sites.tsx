"use client";

// PROTOTYPE (wayfinder ticket #21): the Sites tab (#15). Add, Edit and Delete
// are drawn but do nothing; the real Add opens a dialog with the Places combobox.
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCustomer } from "@/components/use-customer";
import { stubProposals, stubSites } from "@/lib/prototype-hub";

export function CustomerSites({ customerId }: { customerId: string }) {
  const customer = useCustomer(customerId);
  if (!customer) return null;
  const sites = stubSites(customer);
  const proposals = stubProposals(customer);

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-950">Sites</h2>
          <p className="mt-1 text-sm text-slate-500">Where the work happens. Every proposal is for one site.</p>
        </div>
        <Button variant="outline" size="lg">
          <Plus data-icon="inline-start" aria-hidden /> Add site
        </Button>
      </header>
      <ul>
        {sites.map((site) => {
          const count = proposals.filter((p) => p.siteId === site.siteId).length;
          return (
            <li key={site.siteId} className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0">
              <MapPin aria-hidden className="size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{site.name}</span>
                <span className="block truncate text-sm text-slate-500">{site.address}</span>
              </span>
              <span className="hidden shrink-0 text-sm text-slate-500 sm:block">
                {count === 0 ? "No proposals" : count === 1 ? "1 proposal" : `${count} proposals`}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${site.name}`}>
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${site.name}`}
                disabled={count > 0}
                title={count > 0 ? "A site with proposals cannot be deleted." : undefined}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
