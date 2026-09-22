import { Suspense } from "react";

import { CustomerSites } from "@/components/customer-sites";

export default async function CustomerSitesPage({
  params,
}: PageProps<"/customers/[customerId]/sites">) {
  const { customerId } = await params;

  return (
    <Suspense>
      <CustomerSites customerId={customerId} />
    </Suspense>
  );
}
