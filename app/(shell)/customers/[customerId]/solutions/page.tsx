import { Suspense } from "react";

import { CustomerSolutions } from "@/components/customer-solutions";

export default async function CustomerSolutionsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions">) {
  const { customerId } = await params;

  return (
    <Suspense>
      <CustomerSolutions customerId={customerId} />
    </Suspense>
  );
}
