import { Suspense } from "react";

import { ProposalsHome } from "@/components/prototype-proposals-first/home";

// PROTOTYPE (proposals-first): throwaway. The home page is the proposals,
// sorted by what each needs from the owner. The old Dashboard's cards live on
// in components/dashboard-*.tsx, unused on this branch.
export default function HomePage() {
  return (
    <Suspense>
      <ProposalsHome />
    </Suspense>
  );
}
