import { ProposalBoard } from "@/components/proposal-board";

// Home is the Proposal board: the owner thinks in proposals, so the app opens
// on every one of them, sorted by how far each job has got.
export default function HomePage() {
  return <ProposalBoard />;
}
