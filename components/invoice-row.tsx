import type { FunctionReturnType } from "convex/server";

import { InvoiceChip } from "@/components/invoice-chips";
import type { api } from "@/convex/_generated/api";
import { formatCentsExact } from "@/lib/money";
import { cn } from "@/lib/utils";

type InvoiceListRow = FunctionReturnType<typeof api.invoices.forSite>[number];

// One invoice in a list inside a hub page or a panel: its title and chip, a
// line under it, and the amount due on the right. A void invoice is struck
// through, as it is everywhere it is listed.
export function InvoiceRow({
  invoice,
  subtitle,
  open,
  compact = false,
}: {
  invoice: Pick<InvoiceListRow, "title" | "state" | "standing" | "amountDueCents">;
  subtitle?: string;
  open: () => void;
  // Inside a panel, where the row sits in a bordered list of its own.
  compact?: boolean;
}) {
  const voided = invoice.state === "void";
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={open}
        className={cn(
          "flex w-full items-center gap-3 text-left transition-colors hover:bg-slate-50",
          compact ? "px-3 py-2 text-sm" : "px-5 py-3",
        )}
      >
        <span className="min-w-0 flex-1">
          {/* On a phone the chip drops under a long title. */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "max-w-full truncate font-medium text-slate-900",
                voided && "text-slate-500 line-through",
              )}
            >
              {invoice.title}
            </span>
            <InvoiceChip state={invoice.state} standing={invoice.standing} />
          </span>
          {subtitle ? (
            <span className="block truncate text-xs text-slate-500">{subtitle}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "shrink-0 font-semibold text-slate-900 tabular-nums",
            compact && "font-medium",
            voided && "text-slate-400 line-through",
          )}
        >
          {formatCentsExact(invoice.amountDueCents)}
        </span>
      </button>
    </li>
  );
}
