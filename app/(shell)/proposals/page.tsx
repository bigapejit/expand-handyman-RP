// PROTOTYPE (#21): the global Proposals index is not in this prototype.
import { FileSignature } from "lucide-react";

import { IndexEmptyState } from "@/components/index-row";
import { PageHeader } from "@/components/page-header";

export default function ProposalsPage() {
  return (
    <>
      <PageHeader title="Proposals" description="Every proposal across every customer, read-only." />
      <IndexEmptyState icon={FileSignature} title="Not in this prototype">
        Proposals are built on each customer&rsquo;s page. Open a customer to see the Proposals tab.
      </IndexEmptyState>
    </>
  );
}
