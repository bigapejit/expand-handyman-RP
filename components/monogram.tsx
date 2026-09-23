import { cn } from "@/lib/utils";

// A Staff Member drawn as their initials: the rota's row heads (issue #369)
// and the **Sidebar card** (issue #371), which sit on the same screen and
// would otherwise disagree about how somebody's face is spelled.
//
// Decorative on purpose: every place it is used says the name in words beside
// it, so a screen reader that also read "AP" would be reading it twice.
export function Monogram({
  name,
  size = "sm",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-slate-900 font-semibold text-white",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
