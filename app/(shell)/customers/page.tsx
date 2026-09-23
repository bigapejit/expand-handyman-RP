import { CustomersIndex } from "@/components/customers-index";
import { PageHeader } from "@/components/page-header";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="The people Expand works for, their sites and their paperwork."
      />
      <CustomersIndex />
    </div>
  );
}
