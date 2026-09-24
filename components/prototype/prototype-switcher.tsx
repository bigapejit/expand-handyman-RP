"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// PROTOTYPE (#90): the floating bar that flips between variants of a page.
// Never ships: hidden outside development.
export const VARIANT_PARAM = "variant";

export function useVariant<T extends string>(keys: readonly T[]): T {
  const params = useSearchParams();
  const raw = params.get(VARIANT_PARAM);
  return (keys as readonly string[]).includes(raw ?? "") ? (raw as T) : keys[0];
}

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: readonly { key: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    const search = new URLSearchParams(params.toString());
    search.set(VARIANT_PARAM, next.key);
    router.replace(`${pathname}?${search.toString()}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-fuchsia-700 px-1.5 py-1 text-white shadow-lg ring-2 ring-white">
        <button
          type="button"
          aria-label="Previous variant"
          onClick={() => go(-1)}
          className="grid size-8 place-items-center rounded-full hover:bg-fuchsia-600"
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="px-1 text-sm font-semibold tabular-nums">
          {variants[index].key} · {variants[index].name}
        </span>
        <button
          type="button"
          aria-label="Next variant"
          onClick={() => go(1)}
          className="grid size-8 place-items-center rounded-full hover:bg-fuchsia-600"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  );
}
