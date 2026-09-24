"use client";

import { useConvexAuth, useQuery } from "convex/react";
import {
  FileSignature,
  Inbox,
  LayoutDashboard,
  MapPin,
  ReceiptText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Component, type ReactNode } from "react";

import { api } from "@/convex/_generated/api";

// The staff console's pages, in the order both the desktop sidebar and the
// phone's bottom tab bar list them.
export const navigation = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  // Straight after the Dashboard: the Site is the page the owner works from.
  { title: "Sites", href: "/sites", icon: MapPin },
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Thumbtack", href: "/thumbtack", icon: Inbox },
  { title: "Proposals", href: "/proposals", icon: FileSignature },
  { title: "Invoices", href: "/invoices", icon: ReceiptText },
  { title: "Staff", href: "/staff", icon: ShieldCheck },
] as const;

// The phone's tab bar holds six; a seventh squeezes every label. Staff, the
// page visited least, sits behind the account menu there instead.
export const staffPage = navigation[navigation.length - 1];
export const phoneTabs = navigation.filter((item) => item !== staffPage);

/** Whether `href` is the page the owner is on, or a page under it. */
export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
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
