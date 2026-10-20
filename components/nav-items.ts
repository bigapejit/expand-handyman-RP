"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  Calculator,
  FileText,
  MapPin,
  ShieldCheck,
  SquareKanban,
  Users,
  Wallet,
} from "lucide-react";
import { Component, useEffect, type ReactNode } from "react";

import { api } from "@/convex/_generated/api";

// The two places the owner works from, in the order both the desktop sidebar
// and the phone's bottom tab bar list them. The **Pipeline** is home: every
// job he is chasing, Thumbtack leads included, and each deal's proposal one
// tap away. Money is the Invoices page, where the work gets paid.
export const navigation = [
  { title: "Pipeline", href: "/", icon: SquareKanban },
  { title: "Money", href: "/invoices", icon: Wallet },
] as const;

// Everything else, one tap further away under More: a fold in the sidebar,
// a sheet from the phone's third tab. A deal and a proposal's page link to
// their customer and site, so these are seldom the way in.
export const morePages = [
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Sites", href: "/sites", icon: MapPin },
  { title: "Documents", href: "/documents", icon: FileText },
  { title: "Staff", href: "/staff", icon: ShieldCheck },
  // A calculator the owner reaches for now and then, not a list he works.
  { title: "Job math", href: "/job-math", icon: Calculator },
] as const;

/** Whether `href` is the page the owner is on, or a page under it. */
export function isNavActive(pathname: string, href: string): boolean {
  // A proposal's own page is reached from a deal, so it sits under the
  // Pipeline, the home page.
  if (href === "/") return pathname === "/" || pathname.startsWith("/proposals");
  return pathname.startsWith(href);
}

/** Whether the page the owner is on is one of More's, so More reads as current. */
export function isOnMorePage(pathname: string): boolean {
  return morePages.some((page) => isNavActive(pathname, page.href));
}

// Unread Thumbtack leads on open deals, for the badge on the **Pipeline** nav
// item. The nav renders outside the owner gate and `unreadCount` throws for
// anyone but the owner, so it asks only once Convex knows the owner is signed
// in (the gate's own query, shared). Undefined until it hears back; 0 when
// there are none. Call it inside <Quiet>.
export function useUnreadLeads(): number | undefined {
  const auth = useConvexAuth();
  const access = useQuery(api.auth.access, auth.isAuthenticated ? {} : "skip");
  const owner = access?.owner === true;
  // Leads from before deals get theirs the first time the owner opens any
  // page after the deploy, so the count, and the board, miss none of them
  // while the CLI migration waits to be run. Nothing to do on every visit
  // after; the badge is on every page (the phone's tab bar is mounted even
  // where the sidebar is not), so this is the place to ask. A second ask from
  // the other badge finds nothing left to do.
  const backfill = useMutation(api.deals.backfillLeads);
  useEffect(() => {
    if (owner) backfill({}).catch(() => {});
  }, [owner, backfill]);
  return useQuery(api.leads.unreadCount, owner ? {} : "skip");
}

// A badge is never worth the page: if its query fails (a deployment behind
// the app, say), the badge goes and the shell stays.
export class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
