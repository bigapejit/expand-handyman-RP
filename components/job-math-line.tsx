"use client";

import Link from "next/link";

import { useJobMathSettings } from "@/components/job-math-page";
import { jobMath, jobMathHref, type JobInputs } from "@/lib/job-math";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

// **Job math** (CONTEXT.md) for one Solution's price, in one quiet line: what
// the owner keeps an hour doing it himself, and the most it could pay a W-2
// worker. Shown under a price on the Solutions tab and on the proposal page.
// Only once there is a price and some HR lines, since without hours there is
// no per hour to speak of. It never changes the price.
export function JobMathLine({
  inputs,
  className,
}: {
  // lib/job-math.ts `solutionJobInputs`, or null for a Solution with no price.
  inputs: Omit<JobInputs, "wageCents"> | null;
  className?: string;
}) {
  const settings = useJobMathSettings();
  if (settings === undefined || inputs === null || inputs.laborHours <= 0) return null;
  const { owner, w2 } = jobMath(inputs, settings);
  // Whole dollars to keep the line short: take-home to the nearest, since it
  // says "~"; the most it can pay rounded down, so the line never promises a
  // wage the job can't cover. Whether it can pay anyone at all is read from
  // the cents, though, and a wage under a dollar keeps them: flooring $0.94 to
  // $0 would say "Can't pay a W-2" where the calculator says it can.
  const dollarsPerHour = (dollars: number) => `${formatCents(dollars * 100)}/hr`;
  const keep = Math.round((owner.takeHomePerHourCents ?? 0) / 100);
  const maxWageCents = w2.maxWageCents ?? 0;
  const maxWage =
    maxWageCents >= 100
      ? dollarsPerHour(Math.floor(maxWageCents / 100))
      : `${formatCents(maxWageCents)}/hr`;
  return (
    <p className={cn("text-xs text-slate-500", className)}>
      You keep ~{dollarsPerHour(keep)}
      <span aria-hidden> · </span>
      {maxWageCents > 0 ? `Can pay a W-2 up to ${maxWage}` : "Can't pay a W-2"}
      <span aria-hidden> · </span>
      <Link href={jobMathHref(inputs)} className="font-medium text-primary hover:underline">
        Open in Job math
      </Link>
    </p>
  );
}
