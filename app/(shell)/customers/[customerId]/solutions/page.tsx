import { Suspense } from "react";

import { CustomerSolutions } from "@/components/customer-solutions";

export default function Page() {
  return (
    <Suspense>
      <CustomerSolutions />
    </Suspense>
  );
}
