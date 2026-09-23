import { Suspense } from "react";

import { CustomerSites } from "@/components/customer-sites";

export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <Suspense>
      <CustomerSites customerId={customerId} />
    </Suspense>
  );
}
