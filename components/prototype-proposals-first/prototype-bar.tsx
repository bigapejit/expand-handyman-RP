"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

// PROTOTYPE (proposals-first): throwaway. The pill at the top of every
// prototype page, saying it is one and flipping the home page's variant.
// `?bar=off` hides it for a screenshot.
export type Variant = "A" | "B";

export const variants: { key: Variant; name: string }[] = [
  { key: "A", name: "By stage" },
  { key: "B", name: "Whose move" },
];

export function useVariant(): Variant {
  const params = useSearchParams();
  return params.get("variant") === "B" ? "B" : "A";
}

export function PrototypeBar({ switchable = false }: { switchable?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = useVariant();
  if (params.get("bar") === "off") return null;

  const set = (key: Variant) => {
    const search = new URLSearchParams(params.toString());
    search.set("variant", key);
    router.replace(`${pathname}?${search.toString()}`);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-fuchsia-700 py-1 pr-1 pl-3 text-xs font-semibold text-white shadow-lg ring-2 ring-white">
        <span className="tracking-wide">PROTOTYPE</span>
        {switchable ? (
          variants.map((variant) => (
            <button
              key={variant.key}
              type="button"
              onClick={() => set(variant.key)}
              className={cn(
                "rounded-full px-2.5 py-1 hover:bg-fuchsia-600",
                variant.key === current && "bg-white text-fuchsia-900 hover:bg-white",
              )}
            >
              {variant.key} · {variant.name}
            </button>
          ))
        ) : (
          <span className="px-2 py-1 font-medium text-fuchsia-100">· proposal page</span>
        )}
      </div>
    </div>
  );
}
