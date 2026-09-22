"use client";

// PROTOTYPE (wayfinder ticket #21): FRSG's customers-index.tsx on Expand's
// customers. Site counts and proposal hints are stub data (lib/prototype-hub).
import { LoaderCircle, Plus, Search, Users } from "lucide-react";
import { useState } from "react";

import { CustomerDialog } from "@/components/customer-dialog";
import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { ProposalStateChip } from "@/components/proposal-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCustomers } from "@/components/use-customer";
import { customerHint, stubSites, type StubCustomer } from "@/lib/prototype-hub";

export function CustomersIndex() {
  const customers = useCustomers();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const shown = customers
    ?.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

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
            placeholder="Search by customer name"
            aria-label="Search customers"
            className="h-9 pl-8"
          />
        </label>
        <Button size="lg" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          Add customer
        </Button>
      </div>

      {shown === undefined ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <LoaderCircle aria-label="Loading customers" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : shown.length === 0 ? (
        <IndexEmptyState
          icon={Users}
          title={search.trim() ? "No customer matches that" : "No customers yet"}
        >
          {search.trim()
            ? "Search is by customer name."
            : "Add a customer to start writing solutions and proposals for them."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((customer) => (
            <IndexRow
              key={customer._id}
              href={`/customers/${customer._id}`}
              title={customer.name}
              subtitle={subtitle(customer)}
              hint={<ProposalHint customer={customer} />}
            />
          ))}
        </ul>
      )}

      {adding ? <CustomerDialog mode="add" onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function subtitle(customer: StubCustomer): string {
  const n = stubSites(customer).length;
  const sites = n === 1 ? "1 site" : `${n} sites`;
  return customer.email ? `${sites} · ${customer.email}` : sites;
}

function ProposalHint({ customer }: { customer: StubCustomer }) {
  const hint = customerHint(customer);
  if (hint.kind === "awaiting") {
    return <span>{hint.count === 1 ? "1 awaiting a signature" : `${hint.count} awaiting a signature`}</span>;
  }
  if (hint.kind === "outcome") return <ProposalStateChip state={hint.state} />;
  return <span className="text-slate-400">No proposals</span>;
}
