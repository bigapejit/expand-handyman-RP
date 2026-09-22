import { CustomersIndex } from "@/components/customers-index";
import { PageHeader } from "@/components/page-header";

export default function CustomersPage() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="The people Expand works for, and the sites where the work happens."
      />
      <CustomersIndex />
    </>
  );
}
