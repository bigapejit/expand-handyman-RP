import { PageHeader } from "@/components/page-header";
import { ProposalsIndex } from "@/components/proposals-index";

export default function ProposalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Proposals" description="Every proposal across every customer." />
      <ProposalsIndex />
    </div>
  );
}
