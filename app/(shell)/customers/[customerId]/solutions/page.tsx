import { Suspense } from "react";

import { CustomerSolutions } from "@/components/customer-solutions";

export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <Suspense>
      <CustomerSolutions customerId={customerId} />
    </Suspense>
  );
}
