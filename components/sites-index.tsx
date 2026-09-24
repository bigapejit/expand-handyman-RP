"use client";

import { useQuery } from "convex/react";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import { useState } from "react";

import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { siteActivityLabel } from "@/lib/sites";

// The Sites list: one row per Site, the one touched most recently first, and
// one search box that reads the street, the city or the customer's name,
// whichever the owner remembers.
export function SitesIndex() {
  const sites = useQuery(api.sites.list);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const shown = sites?.filter((site) =>
    [site.streetLine, site.cityLine, site.customerName].some((text) =>
      text.toLowerCase().includes(query),
    ),
  );
  // One reading of the clock for the whole list, so rows agree on "today".
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-md">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by street or customer"
            aria-label="Search sites"
            className="h-9 pl-8"
          />
        </label>
      </div>

      {shown === undefined ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <LoaderCircle aria-label="Loading sites" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : shown.length === 0 ? (
        <IndexEmptyState icon={MapPin} title={query ? "No site matches that" : "No sites yet"}>
          {query
            ? "Search reads the street, the city and the customer's name."
            : "Add a site to start pricing work for it."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((site) => (
            <IndexRow
              key={site.siteId}
              href={`/sites/${site.siteId}`}
              title={site.streetLine}
              subtitle={site.customerName}
              hint={
                <>
                  <span>{proposalCount(site.proposalCount)}</span>
                  <span aria-hidden>·</span>
                  <span>{siteActivityLabel(site.lastActivity, now)}</span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function proposalCount(count: number): string {
  if (count === 0) return "No proposals";
  return count === 1 ? "1 proposal" : `${count} proposals`;
}
