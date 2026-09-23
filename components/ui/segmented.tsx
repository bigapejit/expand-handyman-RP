"use client";

import { cn } from "@/lib/utils";

// Two or three choices, one of them on: the control the console uses wherever
// a list can be read one way or another — the board's Everyone / Mine, the
// Dashboard agenda's Mine / Everyone's (issues #314, #324). A radiogroup
// rather than a checkbox, because both readings are named: "not mine" is a
// list of somebody's, not the absence of a filter.
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border bg-white p-0.5 text-sm"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1 font-medium text-slate-600 hover:text-slate-900",
            value === option.value && "bg-slate-900 text-white hover:text-white",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
