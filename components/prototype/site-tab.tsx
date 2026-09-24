"use client";

import { useQuery } from "convex/react";

import { HubLoading } from "@/components/customer-hub-shell";
import { CustomerInvoices } from "@/components/customer-invoices";
import { CustomerProposals } from "@/components/customer-proposals";
import { CustomerSolutions } from "@/components/customer-solutions";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// PROTOTYPE (#90): the site's Proposals, Solutions and Invoices tabs are the
// customer's tabs filtered to this site. They need the customer's id, which
// the site knows.
export function SiteTab({
  siteId,
  tab,
}: {
  siteId: string;
  tab: "proposals" | "solutions" | "invoices";
}) {
  const detail = useQuery(api.sitesPrototype.get, { siteId: siteId as Id<"sites"> });
  if (!detail?.customer) return <HubLoading label="Loading" />;
  const customerId = detail.customer.customerId;
  const id = siteId as Id<"sites">;
  if (tab === "proposals") return <CustomerProposals customerId={customerId} siteId={id} />;
  if (tab === "solutions") return <CustomerSolutions customerId={customerId} siteId={id} />;
  return <CustomerInvoices customerId={customerId} siteId={id} />;
}
