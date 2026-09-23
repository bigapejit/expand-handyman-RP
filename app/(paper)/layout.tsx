import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { OwnerGate } from "@/components/owner-gate";

import "../paper-print.css";
import "../proposal-paper.css";

// Staff pages drawn as paper rather than in the staff shell: the proposal
// paper on its own grey backdrop, with no sidebar or header around it. Signing
// in is checked here once, as the shell checks it for its pages.
export const metadata: Metadata = {
  title: "Proposal paper · Expand Handyman",
};

export default async function PaperLayout({ children }: { children: React.ReactNode }) {
  await auth.protect();
  return <OwnerGate>{children}</OwnerGate>;
}
