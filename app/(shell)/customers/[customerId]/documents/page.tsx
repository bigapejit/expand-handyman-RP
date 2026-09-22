import { Suspense } from "react";

import { CustomerDocuments } from "@/components/customer-documents";

export default async function CustomerDocumentsPage({
  params,
}: PageProps<"/customers/[customerId]/documents">) {
  const { customerId } = await params;

  return (
    <Suspense>
      <CustomerDocuments customerId={customerId} />
    </Suspense>
  );
}
