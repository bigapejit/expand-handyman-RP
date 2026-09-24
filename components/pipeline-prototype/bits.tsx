"use client";

// PROTOTYPE. The small shared pieces every variant reuses: the source badge,
// the stage chip, the "why look at this" flag. Layout is not shared: each
// variant is free to throw the page away.

import { AlertCircle, Globe, Phone, Repeat, UserPlus } from "lucide-react";

import { StageChip } from "@/components/lead-panel";
import { SOURCE_LABELS, type Source } from "@/lib/pipeline-prototype";
import { cn } from "@/lib/utils";

export { StageChip };

// Thumbtack gets the one coloured badge, since it is the one the owner asked
// to spot at a glance; the rest are quiet grey with an icon.
export function SourceBadge({ source, compact = false }: { source: Source; compact?: boolean }) {
  if (source === "thumbtack")
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md bg-[#009fd9]/10 font-semibold text-[#007fae]",
          compact ? "px-1.5 py-px text-[10px]" : "px-1.5 py-0.5 text-[11px]",
        )}
      >
        <ThumbtackMark />
        {compact ? "Thumbtack" : SOURCE_LABELS[source]}
      </span>
    );
  const Icon = source === "referral" ? UserPlus : source === "repeat" ? Repeat : source === "website" ? Globe : Phone;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 font-medium text-slate-600",
        compact ? "px-1.5 py-px text-[10px]" : "px-1.5 py-0.5 text-[11px]",
      )}
    >
      <Icon aria-hidden className="size-3" />
      {compact ? SOURCE_LABELS[source].split(" ")[0] : SOURCE_LABELS[source]}
    </span>
  );
}

function ThumbtackMark() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3 fill-current">
      <path d="M8 1.5c-2.5 0-4 1.6-4 3.6 0 1.4.8 2.5 1.8 3.1L5.4 10H3v1.5h4.2V15h1.6v-3.5H13V10h-2.4l-.4-1.8C11.2 7.6 12 6.5 12 5.1c0-2-1.5-3.6-4-3.6z" />
    </svg>
  );
}

export function AttentionFlag({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
      <AlertCircle aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{reason}</span>
    </span>
  );
}

export const whenFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});
