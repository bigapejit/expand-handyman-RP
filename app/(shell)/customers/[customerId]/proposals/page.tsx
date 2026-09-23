import { Suspense } from "react";

import { CustomerProposals } from "@/components/customer-proposals";

export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <Suspense>
      <CustomerProposals customerId={customerId} />
    </Suspense>
  );
}
