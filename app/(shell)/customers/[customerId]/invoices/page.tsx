import { Suspense } from "react";

import { CustomerInvoices } from "@/components/customer-invoices";

export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <Suspense>
      <CustomerInvoices customerId={customerId} />
    </Suspense>
  );
}
