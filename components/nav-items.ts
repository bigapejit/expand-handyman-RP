"use client";

import { useConvexAuth, useQuery } from "convex/react";
import {
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

// PROTOTYPE (proposals-first): the nav shrinks to the three places the owner
// actually works from. Proposals is the home page; Leads is Thumbtack; Money
// is the Invoices page. Everything else sits under More.
export const navigation = [
  { title: "Proposals", href: "/", icon: FileSignature },
  { title: "Leads", href: "/thumbtack", icon: Inbox },
  { title: "Money", href: "/invoices", icon: Wallet },
] as const;

// The pages still there, one tap further away.
export const morePages = [
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Sites", href: "/sites", icon: MapPin },
  { title: "Documents", href: "/documents", icon: FileText },
  { title: "Staff", href: "/staff", icon: ShieldCheck },
] as const;

// The phone's More tab holds these now, so the account menu carries none.
export const menuPages: readonly (typeof morePages)[number][] = [];
export const phoneTabs = navigation;

/** Whether `href` is the page the owner is on, or a page under it. */
export function isNavActive(pathname: string, href: string): boolean {
  // A proposal's own page lives under Proposals, the home page.
  if (href === "/") return pathname === "/" || pathname.startsWith("/proposals");
  return pathname.startsWith(href);
}

// Unread Thumbtack leads, for the badge on the Thumbtack nav item. The nav
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
