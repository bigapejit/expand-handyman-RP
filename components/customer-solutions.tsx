"use client";

import { HubEmpty, HubSection } from "@/components/customer-hub-shell";

// Pricing solutions fills this tab in.
export function CustomerSolutions() {
  return (
    <HubSection
      title="Solutions"
      description="The priced pieces of work proposals are assembled from."
    >
      <HubEmpty>No solutions yet.</HubEmpty>
    </HubSection>
  );
}
