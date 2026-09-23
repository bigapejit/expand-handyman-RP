import { Suspense } from "react";

import { CustomerProposals } from "@/components/customer-proposals";

export default function Page() {
  return (
    <Suspense>
      <CustomerProposals />
    </Suspense>
  );
}
