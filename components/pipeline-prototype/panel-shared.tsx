"use client";

// PROTOTYPE. What the three panel designs share: the merged timeline (seeded
// activity plus a real Thumbtack lead's chat from Convex), day grouping, and
// time formatting. Layout is deliberately not shared.

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Activity, Deal, Stage } from "@/lib/pipeline-prototype";

export function useTimeline(deal: Deal): Activity[] {
  const leadId = deal.lead?.leadId as Id<"leads"> | undefined;
  const thread = useQuery(api.leads.thread, leadId ? { leadId } : "skip");
  if (!thread) return deal.activity;
  const messages: Activity[] = thread.map((m) => ({
    kind: "message",
    at: m.sentAt,
    from: m.from,
    text: m.text || "Sent an attachment",
  }));
  return [...deal.activity.filter((a) => a.kind !== "message"), ...messages].sort((a, b) => a.at - b.at);
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const clock = (at: number) => timeFormat.format(new Date(at));

/** "Today", "Yesterday", else "Mon, Sep 21". */
export function dayLabel(at: number, now: number) {
  const key = dayKeyFormat.format(new Date(at));
  if (key === dayKeyFormat.format(new Date(now))) return "Today";
  if (key === dayKeyFormat.format(new Date(now - 86_400_000))) return "Yesterday";
  return dateFormat.format(new Date(at));
}

/** The timeline in day buckets, oldest day first, each day oldest first. */
export function groupByDay(items: Activity[], now: number) {
  const groups: { label: string; items: Activity[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "Customer";

export const stageTone: Record<Stage, { bg: string; text: string; fill: string }> = {
  new: { bg: "bg-sky-100", text: "text-sky-900", fill: "bg-sky-500" },
  talking: { bg: "bg-amber-100", text: "text-amber-900", fill: "bg-amber-500" },
  booked: { bg: "bg-teal-100", text: "text-teal-900", fill: "bg-teal-500" },
  estimating: { bg: "bg-orange-100", text: "text-orange-900", fill: "bg-orange-500" },
  quoted: { bg: "bg-violet-100", text: "text-violet-900", fill: "bg-violet-500" },
  won: { bg: "bg-emerald-100", text: "text-emerald-900", fill: "bg-emerald-500" },
  lost: { bg: "bg-slate-200", text: "text-slate-700", fill: "bg-slate-400" },
};
