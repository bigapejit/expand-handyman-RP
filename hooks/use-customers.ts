"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";

// Every staff surface that needs customers reads this one list, so the hub's
// header, its tabs and the dialogs share a single subscription.
export function useCustomers() {
  return useQuery(api.customers.list);
}

/** `undefined` while loading, `null` when no customer has that id. */
export function useCustomer(customerId: string) {
  const customers = useCustomers();
  if (customers === undefined) return undefined;
  return customers.find((c) => c._id === customerId) ?? null;
}
