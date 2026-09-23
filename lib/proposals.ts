// How a Proposal reads in the staff app. Only its state and that state's label
// exist so far, for the chip; the pricing, sending and signing lines join them
// as Proposals are built.

export type ProposalState = "draft" | "sent" | "approved" | "declined";

export function proposalStateLabel(state: ProposalState): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
  }
}
