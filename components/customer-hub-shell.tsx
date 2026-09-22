"use client";

// PROTOTYPE (wayfinder ticket #21): FRSG's site-hub-shell.tsx one level up, as
// the customer page (#14). A fixed header and a tab row; each tab is a route.
import { ArrowLeft, LoaderCircle, Pencil, UserX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { CustomerDialog } from "@/components/customer-dialog";
import { Button } from "@/components/ui/button";
import { useCustomer } from "@/components/use-customer";
import { displayPhone } from "@/lib/customer";
import { cn } from "@/lib/utils";

const Tabs = [
  { key: "proposals", label: "Proposals" },
  { key: "solutions", label: "Solutions" },
  { key: "documents", label: "Documents" },
  { key: "sites", label: "Sites" },
] as const;

export function CustomerHubShell({
  customerId,
  children,
}: {
  customerId: string;
  children: ReactNode;
}) {
  const customer = useCustomer(customerId);
  const [editing, setEditing] = useState(false);

  if (customer === undefined) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading customer" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (customer === null) return <CustomerNotFound />;

  const contact = [customer.email, customer.phone ? displayPhone(customer.phone) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">{contact || "No email or phone yet"}</p>
        </div>
        <Button variant="outline" size="lg" onClick={() => setEditing(true)}>
          <Pencil data-icon="inline-start" aria-hidden /> Edit
        </Button>
      </header>
      <CustomerTabRow customerId={customerId} />
      {children}
      {editing ? (
        <CustomerDialog
          mode="edit"
          initial={{ name: customer.name, email: customer.email, phone: customer.phone, site: customer.site }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

function CustomerTabRow({ customerId }: { customerId: string }) {
  const pathname = usePathname();
  const prefix = `/customers/${customerId}`;
  const segment = pathname === prefix ? "proposals" : pathname.slice(prefix.length + 1).split("/")[0];

  return (
    <nav aria-label="Customer sections" className="border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {Tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={`${prefix}/${tab.key}`}
              aria-current={tab.key === segment ? "page" : undefined}
              className={cn(
                "inline-flex border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab.key === segment
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function CustomerNotFound() {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-slate-50 text-center">
      <div className="px-6">
        <UserX className="mx-auto size-7 text-slate-400" />
        <h1 className="mt-3 font-semibold text-slate-900">No such customer</h1>
        <p className="mt-1 text-sm text-slate-500">
          This link names a customer that does not exist, or one that has since been removed.
        </p>
        <Link
          href="/customers"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to Customers
        </Link>
      </div>
    </div>
  );
}
