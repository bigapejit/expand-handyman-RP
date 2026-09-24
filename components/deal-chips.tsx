import { AlertCircle, Globe, Phone, Repeat, UserPlus, type LucideIcon } from "lucide-react";

import {
  SHORT_SOURCE_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  type Source,
  type Stage,
} from "@/lib/pipeline";
import { cn } from "@/lib/utils";

// A **Deal**'s marks, the same on the **Pipeline**, its Quick panel and the
// customer page: the stage, the source, and why a deal wants looking at.

export function StageChip({ stage }: { stage: Stage }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
        stage === "new" && "border-sky-300 bg-sky-50 text-sky-900",
        stage === "talking" && "border-amber-300 bg-amber-50 text-amber-900",
        stage === "booked" && "border-teal-300 bg-teal-50 text-teal-900",
        stage === "estimating" && "border-orange-300 bg-orange-50 text-orange-900",
        stage === "quoted" && "border-violet-300 bg-violet-50 text-violet-900",
        stage === "won" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        stage === "lost" && "border-slate-300 bg-slate-100 text-slate-600",
      )}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

const SOURCE_ICONS: Record<Exclude<Source, "thumbtack">, LucideIcon> = {
  referral: UserPlus,
  repeat: Repeat,
  website: Globe,
  phone: Phone,
};

// The **Source**. Thumbtack gets the one coloured badge, since it is the one
// the owner spots at a glance; the rest are quiet grey with an icon. Compact
// on a card, where "Repeat customer" reads as "Repeat".
export function SourceBadge({ source, compact = false }: { source: Source; compact?: boolean }) {
  const size = compact ? "px-1.5 py-px text-[10px]" : "px-1.5 py-0.5 text-[11px]";
  if (source === "thumbtack")
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md bg-[#009fd9]/10 font-semibold text-[#007fae]",
          size,
        )}
      >
        <ThumbtackMark />
        {SOURCE_LABELS.thumbtack}
      </span>
    );
  const Icon = SOURCE_ICONS[source];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 font-medium text-slate-600",
        size,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {compact ? SHORT_SOURCE_LABELS[source] : SOURCE_LABELS[source]}
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

/** The small amber flag from `attention()` (lib/pipeline.ts); nothing when it can wait. */
export function AttentionFlag({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
      <AlertCircle aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{reason}</span>
    </span>
  );
}
