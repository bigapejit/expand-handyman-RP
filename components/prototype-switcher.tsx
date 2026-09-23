"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// PROTOTYPE: the floating bar that flips between a prototype's variants. It is
// not part of any design being judged, and never renders in a production build.
export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: readonly { key: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  );

  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    router.replace(`${pathname}?variant=${next.key}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable]") ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }
      go(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  const variant = variants[index];
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-700 px-2 py-1.5 text-sm font-medium text-white shadow-xl ring-2 ring-fuchsia-300">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 whitespace-nowrap">
        {variant.key} ({variant.name}) · {index + 1}/{variants.length}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
