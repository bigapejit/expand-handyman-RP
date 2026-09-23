"use client";

import { useQuery } from "convex/react";
import { LoaderCircle, Plus, Search, Users } from "lucide-react";
import { useState } from "react";

import { AddCustomerDialog } from "@/components/document-dialogs";
import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { displayPhone } from "@/lib/customer";

// FRSG's Customers index: one row each, alphabetical, searched by name.
export function CustomersIndex() {
  const customers = useQuery(api.documents.customers);
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
            : "Add a customer to keep their documents together."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((customer) => (
            <IndexRow
              key={customer._id}
              href={`/customers/${customer._id}`}
              title={customer.name}
              subtitle={[customer.site, customer.email].filter(Boolean).join(" · ")}
              hint={displayPhone(customer.phone)}
            />
          ))}
        </ul>
      )}

      {adding ? <AddCustomerDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
