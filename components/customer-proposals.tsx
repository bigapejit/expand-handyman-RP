"use client";

import { HubEmpty, HubSection } from "@/components/customer-hub-shell";

// The customer page's landing tab. Drafting proposals fills it in.
export function CustomerProposals() {
  return (
    <HubSection
      title="Proposals"
      description="Offers for this customer's sites, each assembled from solutions."
    >
      <HubEmpty>No proposals yet.</HubEmpty>
    </HubSection>
  );
}
