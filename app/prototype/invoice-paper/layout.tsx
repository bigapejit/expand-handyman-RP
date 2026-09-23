// PROTOTYPE (issue #68): throwaway. The proposal paper's stylesheets, as the
// (paper) layout carries them, plus the invoice's own few rules. No sign-in
// and no owner gate: the paper is dummy data.
import type { Metadata } from "next";

import "../../paper-print.css";
import "../../proposal-paper.css";
import "./prototype.css";

export const metadata: Metadata = {
  title: "Invoice paper (prototype) · Expand Handyman",
  robots: { index: false, follow: false },
};

export default function PrototypeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
