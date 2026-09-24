import type { Metadata } from "next";

import "../paper-print.css";
import "../proposal-paper.css";
import "../invoice-paper.css";

// The paper as the PDF renderer reads it, a proposal's or an invoice's, at a
// render pass (CONTEXT.md, **Render pass**; ADR 0002). No sign-in and no owner
// gate: the renderer is a browser with neither, and the pass is its whole
// authority.
export const metadata: Metadata = {
  title: "Proposal paper · Expand Handyman",
};

export default function RenderPaperLayout({ children }: { children: React.ReactNode }) {
  return children;
}
