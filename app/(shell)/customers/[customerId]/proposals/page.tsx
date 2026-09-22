import { Suspense } from "react";

import { CustomerProposals } from "@/components/customer-proposals";

export default async function CustomerProposalsPage({
  params,
}: PageProps<"/customers/[customerId]/proposals">) {
  const { customerId } = await params;

  return (
    <Suspense>
      <CustomerProposals customerId={customerId} />
    </Suspense>
  );
}
