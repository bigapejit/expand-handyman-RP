import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

// The cards a Site page tab and the Customer page are built from.

/** A tab's own card: a heading, a line under it and the tab's one action. */
export function HubSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function HubLoading({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center">
      <LoaderCircle aria-label={label} className="size-6 animate-spin text-slate-500" />
    </div>
  );
}

export function HubEmpty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-500">{children}</p>;
}
