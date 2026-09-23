import { Suspense } from "react";

import { CustomerDocuments } from "@/components/customer-documents";

export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <Suspense>
      <CustomerDocuments customerId={customerId} />
    </Suspense>
  );
}
