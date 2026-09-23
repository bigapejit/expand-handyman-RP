"use client";

import { LoaderCircle, Plus, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CustomerDialog } from "@/components/customer-dialog";
import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCustomers } from "@/hooks/use-customers";

// FRSG's Customers index: one row each, alphabetical, searched by name.
export function CustomersIndex() {
  const customers = useCustomers();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const query = search.trim().toLowerCase();
  const shown = customers
    ?.filter((c) => c.name.toLowerCase().includes(query))
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
          title={query ? "No customer matches that" : "No customers yet"}
        >
          {query
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
              subtitle={[
                customer.siteCount === 1
                  ? "1 site"
                  : `${customer.siteCount} sites`,
                customer.email,
              ]
                .filter(Boolean)
                .join(" · ")}
              // Proposal activity: "1 awaiting a signature" or the last
              // outcome once proposals exist.
              hint={<span className="text-slate-400">No proposals</span>}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <CustomerDialog
          onClose={() => setAdding(false)}
          onSaved={(id) => router.push(`/customers/${id}`)}
        />
      ) : null}
    </div>
  );
}
