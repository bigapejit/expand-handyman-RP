import { ProposalPage } from "@/components/proposal-page";

// One proposal, the whole job in one scroll: the page the owner works a
// proposal from.
export default async function ProposalRoute({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  return <ProposalPage proposalId={proposalId} />;
}
