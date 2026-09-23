"use client";

import { useQuery } from "convex/react";
import { FileSignature, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";

import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { ProposalStateChip } from "@/components/proposal-chips";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/convex/_generated/api";
import { formatCents } from "@/lib/money";
import { proposalPanelHref, proposalStateLabel, type ProposalState } from "@/lib/proposals";

type Filter = "all" | ProposalState;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  ...(["draft", "sent", "approved", "declined"] as const).map((state) => ({
    value: state,
    label: proposalStateLabel(state),
  })),
];

// Every proposal across every customer, newest first, as FRSG's flat index.
// Read-only: a row opens the proposal on its customer's Proposals tab, where it
// is worked. Search reads the customer, the Proposal ID and the title.
export function ProposalsIndex() {
  const proposals = useQuery(api.proposals.list);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const query = search.trim().toLowerCase();
  const shown = proposals?.filter(
    (p) =>
      (filter === "all" || p.state === filter) &&
      `${p.customerName} ${p.code} ${p.title}`.toLowerCase().includes(query),
  );

  return (
    <div className="space-y-4">
      <label className="relative block w-full max-w-md">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by customer, Proposal ID or title"
          aria-label="Search proposals"
          className="h-9 pl-8"
        />
      </label>
      <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
        <Segmented label="State" value={filter} onChange={setFilter} options={filters} />
      </div>

      {shown === undefined ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <LoaderCircle aria-label="Loading proposals" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : shown.length === 0 ? (
        <IndexEmptyState
          icon={FileSignature}
          title={proposals?.length ? "No proposal matches that" : "No proposals yet"}
        >
          {proposals?.length
            ? "Try a different search or state."
            : "Start one from a customer's Proposals tab."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((p) => (
            <IndexRow
              key={p.proposalId}
              href={proposalPanelHref(p.customerId, p.proposalId)}
              title={`${p.code} · ${p.title}`}
              subtitle={p.customerName}
              hint={
                <>
                  <ProposalStateChip state={p.state} />
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatCents(p.totalCents)}
                  </span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
