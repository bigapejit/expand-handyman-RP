"use client";

// PROTOTYPE (wayfinder ticket #21): the Solutions tab as a list only, rows
// tagged with their site. The solution panel itself is not prototyped.
import { NewForSite, SiteTag } from "@/components/customer-proposals";
import { useCustomer } from "@/components/use-customer";
import { formatCents, stubSites, stubSolutions } from "@/lib/prototype-hub";
import { cn } from "@/lib/utils";

export function CustomerSolutions({ customerId }: { customerId: string }) {
  const customer = useCustomer(customerId);
  if (!customer) return null;
  const sites = stubSites(customer);
  const solutions = stubSolutions(customer);

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-950">Solutions</h2>
          <p className="mt-1 text-sm text-slate-500">
            {solutions.length} solutions: the pieces of work proposals are assembled from.
          </p>
        </div>
        <NewForSite sites={sites} label="New solution" />
      </header>
      <ol>
        {solutions.map((solution) => (
          <li key={solution.solutionId} className="border-b last:border-b-0">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{solution.title}</span>
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <SiteTag site={sites.find((s) => s.siteId === solution.siteId)} />
                  <span aria-hidden>·</span>
                  {solution.lineCount} line items
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-sm tabular-nums",
                  solution.priceCents === null ? "text-amber-700" : "font-semibold text-slate-900",
                )}
              >
                {solution.priceCents === null ? "No price yet" : formatCents(solution.priceCents)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
