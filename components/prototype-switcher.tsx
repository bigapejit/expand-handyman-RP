"use client";

// PROTOTYPE, delete before merge. A floating pill that flips a page between
// design variants through `?variant=`. Arrow keys cycle too, except while
// typing. Never shown in production.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: { value: string; label: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.value === current),
  );

  const go = useCallback(
    (step: number) => {
      const next = variants[(index + step + variants.length) % variants.length];
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", next.value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [variants, index, searchParams, pathname, router],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      go(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (process.env.NODE_ENV === "production") return null;

  const label = variants[index]?.label ?? current;

  return (
    <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-950 p-1 text-white shadow-2xl ring-1 ring-white/10">
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous variant"
        className="grid size-8 place-items-center rounded-full hover:bg-white/15"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <span className="min-w-36 px-2 text-center text-sm font-medium tabular-nums">
        <span className="text-white/50">
          {index + 1}/{variants.length}
        </span>{" "}
        {label}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next variant"
        className="grid size-8 place-items-center rounded-full hover:bg-white/15"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
