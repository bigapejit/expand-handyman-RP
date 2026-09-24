"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, KeyRound, LoaderCircle, MapPinOff, Pencil, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { SiteDialog } from "@/components/site-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

// The Site page, the one the owner works from, laid out as FRSG's
// site-hub-shell.tsx is. The street as the title, the city line, whose site
// it is and how to get in under it, Edit site on the right, then a tab row,
// each tab its own route so it can be bookmarked and Back works.
const TABS = [
  { key: "proposals", label: "Proposals" },
  { key: "solutions", label: "Solutions" },
  { key: "photos", label: "Photos" },
  { key: "invoices", label: "Invoices" },
] as const;

export function SiteHubShell({ siteId, children }: { siteId: string; children: ReactNode }) {
  const detail = useQuery(api.sites.get, { siteId });
  // The site as it stood when Edit site opened. The dialog sits beside the
  // page rather than in it, so it outlives the site when Delete site succeeds
  // and the page shows a spinner, not "No such site", while the dialog moves
  // on to the Sites list.
  const [editing, setEditing] = useState<Doc<"sites"> | null>(null);

  let page: ReactNode;
  if (detail === undefined || (detail === null && editing))
    page = (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading site" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  else if (detail === null) page = <SiteNotFound />;
  else
    page = (
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{detail.streetLine}</h1>
            <p className="text-sm text-muted-foreground">{detail.cityLine}</p>
            <p className="text-sm">
              <Link
                href={`/customers/${detail.customerId}`}
                // Expand: a taller target on a phone, the margin keeping the
                // header's rhythm.
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline max-md:-my-2.5 max-md:py-2.5"
              >
                <User aria-hidden className="size-3.5" />
                {detail.customerName}
              </Link>
            </p>
            {detail.accessNotes ? (
              <p className="text-sm text-slate-600">
                <KeyRound aria-hidden className="mr-1 inline size-3.5 text-slate-400" />
                {detail.accessNotes}
              </p>
            ) : null}
          </div>
          <Button variant="outline" size="lg" onClick={() => setEditing(detail.site)}>
            <Pencil data-icon="inline-start" aria-hidden /> Edit site
          </Button>
        </header>
        <SiteTabRow siteId={siteId} counts={detail.counts} />
        {children}
      </div>
    );

  return (
    <>
      {page}
      {editing ? <SiteDialog site={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function SiteTabRow({
  siteId,
  counts,
}: {
  siteId: string;
  counts: Record<(typeof TABS)[number]["key"], number>;
}) {
  const pathname = usePathname();
  const prefix = `/sites/${siteId}`;
  const segment = pathname.slice(prefix.length + 1).split("/")[0];

  return (
    <nav aria-label="Site sections" className="border-b">
      <ul className="no-scrollbar -mb-px flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Link
              href={`${prefix}/${tab.key}`}
              aria-current={tab.key === segment ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                tab.key === segment
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.label}
              <TabCount count={counts[tab.key]} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// What a tab holds, beside its label. An empty tab shows no count, so the
// ones with something in them stand out.
function TabCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600 tabular-nums">
      {count}
    </span>
  );
}

function SiteNotFound() {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-slate-50 text-center">
      <div className="px-6">
        <MapPinOff className="mx-auto size-7 text-slate-400" />
        <h1 className="mt-3 font-semibold text-slate-900">No such site</h1>
        <p className="mt-1 text-sm text-slate-500">
          This link names a site that does not exist, or one that has since been removed.
        </p>
        <Link
          href="/sites"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to Sites
        </Link>
      </div>
    </div>
  );
}
