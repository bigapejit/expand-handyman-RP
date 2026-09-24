"use client";

import { useQuery } from "convex/react";
import { LoaderCircle, MapPin, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { NewSiteDialog } from "@/components/prototype/new-site-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";

// PROTOTYPE (#90): the Sites list as issue #88 decided it. One row per site,
// last activity first, one search box that reads the street or the customer.
export function SitesIndex() {
  const sites = useQuery(api.sitesPrototype.list);
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const query = search.trim().toLowerCase();
  const shown = sites?.filter((s) =>
    `${s.address} ${s.customerName}`.toLowerCase().includes(query),
  );

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
        <Button size="lg" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          New site
        </Button>
      </div>

      {shown === undefined ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <LoaderCircle aria-label="Loading sites" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : shown.length === 0 ? (
        <IndexEmptyState icon={MapPin} title={query ? "No site matches that" : "No sites yet"}>
          {query
            ? "Search reads the street and the customer's name."
            : "Add a site to start pricing work for it."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((site) => (
            <IndexRow
              key={site.siteId}
              href={`/sites/${site.siteId}`}
              title={site.street}
              subtitle={site.customerName}
              hint={
                <>
                  <span>
                    {site.proposalCount === 0
                      ? "No proposals"
                      : site.proposalCount === 1
                        ? "1 proposal"
                        : `${site.proposalCount} proposals`}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{activityLabel(site.lastActivity)}</span>
                </>
              }
            />
          ))}
        </ul>
      )}

      {adding ? (
        <NewSiteDialog
          onClose={() => setAdding(false)}
          onSaved={(siteId) => router.push(`/sites/${siteId}`)}
        />
      ) : null}
    </div>
  );
}

function activityLabel(at: number) {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
