import { DashboardDocuments } from "@/components/dashboard-documents";
import { PageHeader } from "@/components/page-header";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="What is waiting on a customer, and what they decided."
      />
      <DashboardDocuments />
    </div>
  );
}
