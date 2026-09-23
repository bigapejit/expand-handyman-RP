import { proposalStateLabel, type ProposalState } from "@/lib/proposals";
import { cn } from "@/lib/utils";

// A Proposal's state as a chip, the same on the Site's Proposals tab and on
// the Dashboard so a row read on one surface looks the way it will on the
// other. Draft carries no chip: it is what a Proposal is until something
// happens to it, and a row of grey "Draft" badges says nothing. The three
// that are worth a glance each get their own colour.
export function ProposalStateChip({ state }: { state: ProposalState }) {
  if (state === "draft") return null;

  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
        state === "sent" && "border-sky-300 bg-sky-50 text-sky-900",
        state === "approved" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        state === "declined" && "border-slate-300 bg-slate-100 text-slate-600",
      )}
    >
      {proposalStateLabel(state)}
    </span>
  );
}
