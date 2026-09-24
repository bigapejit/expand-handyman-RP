import { DashboardInvoices } from "@/components/dashboard-invoices";
import { DashboardProposals } from "@/components/dashboard-proposals";
import { PageHeader } from "@/components/page-header";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="What is waiting on a customer, what they decided, and what they owe."
      />
      <div className="space-y-8">
        <DashboardProposals />
        <DashboardInvoices />
      </div>
    </div>
  );
}
