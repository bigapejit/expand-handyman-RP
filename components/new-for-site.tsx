"use client";

import { useQuery } from "convex/react";
import { MapPin, Plus } from "lucide-react";
import { useState } from "react";

import { SiteDialog } from "@/components/site-dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// "New solution" and "New proposal" ask which site first, since each belongs
// to one. A customer with no sites is offered one straight from the popover.
export function NewForSite({
  customerId,
  label,
  disabled,
  onPick,
}: {
  customerId: Id<"customers">;
  label: string;
  disabled?: boolean;
  onPick: (siteId: Id<"sites">) => void;
}) {
  const sites = useQuery(api.sites.forCustomer, { customerId });
  const [open, setOpen] = useState(false);
  const [addingSite, setAddingSite] = useState(false);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          render={<Button variant="outline" size="lg" />}
        >
          <Plus data-icon="inline-start" aria-hidden /> {label}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 gap-1 p-1.5">
          <p className="px-2 pt-1 pb-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Which site?
          </p>
          {sites?.length === 0 ? (
            <p className="px-2 pb-1.5 text-sm text-slate-500">
              This customer has no sites yet.
            </p>
          ) : null}
          {(sites ?? []).map((site) => (
            <button
              key={site._id}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(site._id);
              }}
              className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <MapPin aria-hidden className="size-3.5 text-slate-400" />
                {site.name}
              </span>
              <span className="text-xs text-slate-500">{site.address}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setAddingSite(true);
            }}
            className="flex w-full items-center gap-1.5 rounded-md border-t px-2 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            <Plus aria-hidden className="size-3.5" /> Add a site
          </button>
        </PopoverContent>
      </Popover>
      {addingSite ? (
        <SiteDialog customerId={customerId} onClose={() => setAddingSite(false)} />
      ) : null}
    </>
  );
}

// The site a solution or proposal belongs to, on its row in a customer tab.
export function SiteTag({ name }: { name: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-slate-500">
      <MapPin aria-hidden className="size-3" />
      {name}
    </span>
  );
}
