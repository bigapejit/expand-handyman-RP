// PROTOTYPE (issue #22): throwaway. FRSG's paper stylesheets, as the sign
// layout would carry them.
import type { Metadata } from "next";

import "./fonts.css";
import "./proposal-document.css";
import "./print.css";
import "./prototype.css";

export const metadata: Metadata = {
  title: "Your Expand Handyman proposal (prototype)",
  robots: { index: false, follow: false },
};

export default function PrototypeLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-1 flex-col bg-white">{children}</div>;
}
