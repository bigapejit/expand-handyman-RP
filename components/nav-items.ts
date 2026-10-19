"use client";

import { useConvexAuth, useQuery } from "convex/react";
import {
  Calculator,
  FileSignature,
  FileText,
  Inbox,
  MapPin,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { Component, type ReactNode } from "react";

import { api } from "@/convex/_generated/api";

// The three places the owner works from, in the order both the desktop
// sidebar and the phone's bottom tab bar list them. He thinks in proposals,
// so the Proposal board is home; Leads is the Thumbtack board, where work
// comes in; Money is the Invoices page, where it gets paid.
export const navigation = [
  { title: "Proposals", href: "/", icon: FileSignature },
  { title: "Leads", href: "/thumbtack", icon: Inbox },
  { title: "Money", href: "/invoices", icon: Wallet },
] as const;

// Everything else, one tap further away under More: a fold in the sidebar,
// a sheet from the phone's fourth tab. A proposal's page links to its
// customer and its site, so these are seldom the way in.
export const morePages = [
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Sites", href: "/sites", icon: MapPin },
  // A calculator the owner reaches for now and then, not a list he works.
  { title: "Job math", href: "/job-math", icon: Calculator },
  { title: "Documents", href: "/documents", icon: FileText },
  { title: "Staff", href: "/staff", icon: ShieldCheck },
] as const;

/** Whether `href` is the page the owner is on, or a page under it. */
export function isNavActive(pathname: string, href: string): boolean {
  // A proposal's own page sits under Proposals, the home page.
  if (href === "/") return pathname === "/" || pathname.startsWith("/proposals");
  return pathname.startsWith(href);
}

/** Whether the page the owner is on is one of More's, so More reads as current. */
export function isOnMorePage(pathname: string): boolean {
  return morePages.some((page) => isNavActive(pathname, page.href));
}

// Unread Thumbtack leads, for the badge on the Leads nav item. The nav
// renders outside the owner gate and `unreadCount` throws for anyone but the
// owner, so it asks only once Convex knows the owner is signed in (the gate's
// own query, shared). Undefined until it hears back; 0 when there are none.
// Call it inside <Quiet>.
export function useUnreadLeads(): number | undefined {
  const auth = useConvexAuth();
  const access = useQuery(api.auth.access, auth.isAuthenticated ? {} : "skip");
  return useQuery(api.leads.unreadCount, access?.owner ? {} : "skip");
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
