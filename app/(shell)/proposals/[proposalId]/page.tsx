import { Suspense } from "react";

import { ProposalPage } from "@/components/prototype-proposals-first/proposal-page";

// PROTOTYPE (proposals-first): throwaway. One proposal, the whole job in one
// scroll.
export default async function PrototypeProposalPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  return (
    <Suspense>
      <ProposalPage proposalId={proposalId} />
    </Suspense>
  );
}
