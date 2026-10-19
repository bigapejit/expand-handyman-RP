import { redirect } from "next/navigation";

// A proposal is reached from its deal on the Pipeline, the home page, so the
// old Proposals table is gone; a bookmark or an old link to it lands there.
export default function OldProposalsPage() {
  redirect("/");
}
