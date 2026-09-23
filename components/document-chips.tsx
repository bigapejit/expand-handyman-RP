import { cn } from "@/lib/utils";

export type DocumentStatus = "draft" | "ready" | "viewed" | "signed" | "declined";

export const documentStatusLabels: Record<DocumentStatus, string> = {
  draft: "Draft",
  ready: "Link ready",
  viewed: "Viewed",
  signed: "Signed",
  declined: "Declined",
};

// A document's status in the proposal chip's shape. Documents keep their own
// words for it; a draft has a chip too, since the Documents list filters by it.
export function DocumentStatusChip({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
        status === "draft" && "border-slate-300 bg-white text-slate-600",
        status === "ready" && "border-amber-300 bg-amber-50 text-amber-900",
        status === "viewed" && "border-sky-300 bg-sky-50 text-sky-900",
        status === "signed" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        status === "declined" && "border-slate-300 bg-slate-100 text-slate-600",
      )}
    >
      {documentStatusLabels[status]}
    </span>
  );
}
