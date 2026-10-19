import { redirect } from "next/navigation";

// Every proposal is on the board now, the home page, so the old Proposals
// table is gone; a bookmark or an old link to it lands there.
export default function OldProposalsPage() {
  redirect("/");
}
