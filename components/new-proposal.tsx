"use client";

import { useAction, useQuery } from "convex/react";
import { LoaderCircle, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { proposalPageHref } from "@/lib/proposals";
import { errorMessage } from "@/lib/utils";

// How many sites the picker lists at once: enough to find one by eye, few
// enough that a phone shows them without scrolling.
const ShownSites = 8;

// The board's New proposal. It asks one thing, where the work is, then makes
// a draft there (`proposals.create`, as the site page's own button does) and
// opens it on its page. A brand-new customer still starts on Customers,
// because adding one asks for an address the picker has no room for.
export function NewProposalButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" className={className} onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" aria-hidden /> New proposal
      </Button>
      {open ? <NewProposalDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewProposalDialog({ onClose }: { onClose: () => void }) {
  const sites = useQuery(api.sites.list);
  // An action rather than a mutation: a Washington site's tax rate comes from
  // the Department of Revenue, and the new draft carries it from the start.
  const create = useAction(api.proposals.create);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<Id<"sites"> | null>(null);
  const [error, setError] = useState("");

  // The sites list comes most recently touched first, so with nothing typed
  // the site the owner was just at is at the top.
  const needle = query.trim().toLowerCase();
  const matches = (sites ?? [])
    .filter(
      (site) =>
        !needle ||
        site.customerName.toLowerCase().includes(needle) ||
        site.streetLine.toLowerCase().includes(needle),
    )
    .slice(0, ShownSites);

  const start = async (siteId: Id<"sites">) => {
    setBusy(siteId);
    setError("");
    try {
      router.push(proposalPageHref(await create({ siteId })));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New proposal</DialogTitle>
          <DialogDescription>Who is it for?</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
          />
          <Input
            autoFocus
            aria-label="Customer or street"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Customer or street"
            className="h-11 pl-9 text-base"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {sites === undefined ? (
          <div className="grid h-32 place-items-center">
            <LoaderCircle aria-label="Loading" className="size-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <ul className="-mx-2 max-h-80 overflow-y-auto">
            {matches.map((site) => (
              <li key={site.siteId}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void start(site.siteId)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">
                      {site.customerName}
                    </span>
                    <span className="block truncate text-sm text-slate-500">
                      {site.streetLine}
                    </span>
                  </span>
                  {busy === site.siteId ? (
                    <LoaderCircle aria-hidden className="size-4 animate-spin text-slate-400" />
                  ) : null}
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">
                {needle ? "Nobody by that name." : "No sites yet."}
              </li>
            ) : null}
          </ul>
        )}
        <p className="text-sm text-slate-500">
          Someone new?{" "}
          <Link href="/customers" className="font-medium text-primary hover:underline">
            Add the customer first
          </Link>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
