"use client";

import { ArrowLeft, LoaderCircle, Pencil, UserX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { CustomerDialog } from "@/components/customer-dialog";
import { Button } from "@/components/ui/button";
import { useCustomer } from "@/hooks/use-customers";
import { displayPhone } from "@/lib/customer";
import { cn } from "@/lib/utils";

// FRSG's site-hub-shell.tsx one level up, as the customer page: a fixed header
// and a tab row, each tab its own route so it can be bookmarked and Back works.
const TABS = [
  { key: "proposals", label: "Proposals" },
  { key: "invoices", label: "Invoices" },
  { key: "solutions", label: "Solutions" },
  { key: "documents", label: "Documents" },
  { key: "thumbtack", label: "Thumbtack" },
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

  // A number that came with a Thumbtack lead may be a relay that stops working.
  const phone =
    customer.phone && customer.phoneFrom === "thumbtack"
      ? `${displayPhone(customer.phone)} · Thumbtack number`
      : displayPhone(customer.phone);
  const contact = [customer.email, phone].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">{contact}</p>
        </div>
        <Button variant="outline" size="lg" onClick={() => setEditing(true)}>
          <Pencil data-icon="inline-start" aria-hidden /> Edit
        </Button>
      </header>
      <CustomerTabRow customerId={customerId} />
      {children}
      {editing ? (
        <CustomerDialog customer={customer} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

function CustomerTabRow({ customerId }: { customerId: string }) {
  const pathname = usePathname();
  const prefix = `/customers/${customerId}`;
  const segment = pathname.slice(prefix.length + 1).split("/")[0];

  return (
    <nav aria-label="Customer sections" className="border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
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

/** A tab's own card: a heading, a line under it and the tab's one action. */
export function HubSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function HubLoading({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center">
      <LoaderCircle aria-label={label} className="size-6 animate-spin text-slate-500" />
    </div>
  );
}

export function HubEmpty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-500">{children}</p>;
}
