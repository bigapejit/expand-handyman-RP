// PROTOTYPE (#112): throwaway. The paper's stylesheets, as the (paper) layout
// and the invoice link carry them, plus the sketches' own few rules. No
// sign-in and no owner gate: everything here is dummy data, as the customer's
// own link has none either.
import type { Metadata } from "next";

import "../../paper-print.css";
import "../../proposal-paper.css";
import "../../invoice-paper.css";
import "./prototype.css";

export const metadata: Metadata = {
  title: "Pay now (prototype) · Expand Handyman",
  robots: { index: false, follow: false },
};

export default function PrototypeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
