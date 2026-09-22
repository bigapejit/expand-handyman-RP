"use client";

// PROTOTYPE (#21): reads customers off the existing list query so the
// prototype needs no Convex deploy, padded with a few made-up customers so
// the index has some density. The made-up ones have ids starting "stub-".
import { useConvexAuth, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { StubCustomer } from "@/lib/prototype-hub";

const StubCustomers: StubCustomer[] = [
  { _id: "stub-maria", name: "Maria Delgado", email: "maria.delgado@example.com", phone: "+13605550142", site: "4410 NE 94th St, Vancouver, WA 98665" },
  { _id: "stub-harlow", name: "Harlow Property Group", email: "ops@harlowpg.example", phone: "+15645550118", site: "1215 Broadway St, Vancouver, WA 98660" },
  { _id: "stub-ben", name: "Ben and Priya Okafor", email: "okafor.home@example.com", phone: "+13605550177", site: "16203 SE 21st St, Vancouver, WA 98683" },
  { _id: "stub-evergreen", name: "Evergreen Dental", email: "office@evergreendental.example", phone: "+13605550190", site: "2800 Main St, Vancouver, WA 98663" },
];

export function useCustomers(): StubCustomer[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  const real = useQuery(api.documents.customers, isAuthenticated ? {} : "skip");
  if (real === undefined) return undefined;
  return [...real, ...StubCustomers];
}

export function useCustomer(customerId: string) {
  const customers = useCustomers();
  if (customers === undefined) return undefined;
  return customers.find((c) => c._id === customerId) ?? null;
}
