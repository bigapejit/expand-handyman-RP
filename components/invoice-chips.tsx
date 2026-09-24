import type { Standing } from "@/lib/invoice-standing";
import {
  invoiceBadge,
  invoiceBadgeLabel,
  type InvoiceState,
} from "@/lib/invoices";
import { cn } from "@/lib/utils";

// An invoice's one chip, beside the proposal chips (proposal-chips.tsx) and
// drawn the same way, so an invoice row reads like a proposal row: its
// **Standing** once sent, and Draft or Void where it has none. Unlike a
// proposal's, a draft invoice does carry a chip, because a list of invoices
// mixes bills that are owed with ones nobody has seen yet.
export function InvoiceChip({
  state,
  standing,
}: {
  state: InvoiceState;
  standing: Standing | null;
}) {
  const badge = invoiceBadge({ state, standing });
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
        badge === "unpaid" && "border-sky-300 bg-sky-50 text-sky-900",
        badge === "overdue" && "border-red-300 bg-red-50 text-red-900",
        badge === "paid" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        badge === "draft" && "border-dashed border-slate-300 bg-white text-slate-600",
        badge === "void" && "border-slate-300 bg-slate-100 text-slate-500",
      )}
    >
      {invoiceBadgeLabel(badge)}
    </span>
  );
}
