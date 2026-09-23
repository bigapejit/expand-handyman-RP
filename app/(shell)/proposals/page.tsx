import { FileSignature } from "lucide-react";

import { IndexEmptyState } from "@/components/index-row";
import { PageHeader } from "@/components/page-header";

export default function ProposalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        description="Every proposal across every customer."
      />
      <IndexEmptyState icon={FileSignature} title="No proposals yet">
        Proposals you write for your customers will be listed here.
      </IndexEmptyState>
    </div>
  );
}
