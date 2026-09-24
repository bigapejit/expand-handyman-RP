"use client";

// PROTOTYPE. The floating bar that flips a page between its `?variant=`
// renderings. Arrows and ←/→ keys cycle; the URL is replaced so a variant can
// be linked to. Never rendered in a production build.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PrototypeSwitcher({
  variants,
  current,
  param = "variant",
}: {
  variants: { key: string; name: string }[];
  current: string;
  param?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, next.key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, pathname, searchParams]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-700 px-1.5 py-1 text-white shadow-lg ring-2 ring-white">
      <button type="button" aria-label="Previous variant" onClick={() => go(-1)} className="grid size-7 place-items-center rounded-full hover:bg-white/15">
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 text-xs font-semibold tracking-wide">
        PROTOTYPE · {variants[index].key} <span className="font-normal opacity-80">({variants[index].name})</span>
      </span>
      <button type="button" aria-label="Next variant" onClick={() => go(1)} className="grid size-7 place-items-center rounded-full hover:bg-white/15">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
