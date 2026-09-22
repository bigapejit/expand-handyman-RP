// PROTOTYPE (#21): the Dashboard's Proposals and Documents cards are not in
// this prototype; only the shell around them is.
import { LayoutDashboard } from "lucide-react";

import { IndexEmptyState } from "@/components/index-row";
import { PageHeader } from "@/components/page-header";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="What is waiting on a customer, and what they decided." />
      <IndexEmptyState icon={LayoutDashboard} title="Not in this prototype">
        The Proposals and Documents cards land here. This prototype covers the shell and the Customers pages.
      </IndexEmptyState>
    </>
  );
}
