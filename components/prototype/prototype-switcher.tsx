"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// PROTOTYPE (#130): the floating bar that flips between variants of a page,
// as the pay-now prototype (#112) drew it, with any number of pill rows above
// it for the other knobs a page has (`?mode=`, `?relay=`). Never ships: hidden
// outside development.
export const VARIANT_PARAM = "variant";

export function useParamChoice<T extends string>(param: string, keys: readonly T[]): T {
  const params = useSearchParams();
  const raw = params.get(param);
  return (keys as readonly string[]).includes(raw ?? "") ? (raw as T) : keys[0];
}

export function useVariant<T extends string>(keys: readonly T[]): T {
  return useParamChoice(VARIANT_PARAM, keys);
}

export type Choice = { key: string; name: string };
export type PillRow = { param: string; choices: readonly Choice[]; current: string };

export function PrototypeSwitcher({
  variants,
  current,
  rows = [],
}: {
  variants: readonly Choice[];
  current: string;
  rows?: readonly PillRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  // Framed for a screenshot: the bar would cover half a phone, and the URL
  // already names the variant.
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    setFramed(window.self !== window.top);
  }, []);

  const set = (param: string, value: string) => {
    const search = new URLSearchParams(params.toString());
    search.set(param, value);
    router.replace(`${pathname}?${search.toString()}`);
  };
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    set(VARIANT_PARAM, next.key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production" || framed || params.get("bar") === "off") return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 top-14 z-[60] flex flex-col items-end gap-1.5">
      {rows.map((row) => (
        <div
          key={row.param}
          className="pointer-events-auto flex max-w-[95vw] flex-wrap justify-center gap-1 rounded-full bg-fuchsia-900/90 px-1.5 py-1 text-white shadow-lg ring-2 ring-white"
        >
          {row.choices.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => set(row.param, c.key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold hover:bg-fuchsia-700",
                c.key === row.current && "bg-white text-fuchsia-900 hover:bg-white",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      ))}
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
