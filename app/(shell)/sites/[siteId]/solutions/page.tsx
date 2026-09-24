import { Suspense } from "react";

import { CustomerSolutions } from "@/components/customer-solutions";
import type { Id } from "@/convex/_generated/dataModel";

// The site layout shows this page only once the id names a site.
export default async function Page({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  return (
    <Suspense>
      <CustomerSolutions scope={{ siteId: siteId as Id<"sites"> }} />
    </Suspense>
  );
}
