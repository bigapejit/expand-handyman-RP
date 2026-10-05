"use client";

import { useQuery } from "convex/react";

import { HubSection } from "@/components/hub-section";
import { LeadAsked, LeadChat, SendOnThumbtack, StageChip } from "@/components/lead-panel";
import { FieldHeading } from "@/components/side-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCustomer } from "@/hooks/use-customers";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
});

// The customer's leads, newest first, each laid open with what they asked and
// the whole Thumbtack chat, under the customer page's Documents. Read-only, as
// on the board: replies go out on Thumbtack, and the stage is moved from the
// board's panel. A customer the owner added by hand has no leads, so their
// page shows no Thumbtack section at all, not even while it loads.
export function CustomerThumbtack({ customerId }: { customerId: string }) {
  const leads = useQuery(api.leads.forCustomer, {
    customerId: customerId as Id<"customers">,
  });
  const customer = useCustomer(customerId);
  if (!leads?.length) return null;

  return (
    <HubSection title="Thumbtack" description="Leads that came in from Thumbtack and their chats.">
      <ol>
        {leads.map((lead) => (
          <li key={lead._id} className="space-y-4 border-b px-5 py-5 last:border-b-0">
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-medium text-slate-900">{lead.category}</h3>
              <span aria-hidden className="text-slate-400">
                ·
              </span>
              <span className="text-sm text-slate-500">
                Arrived {dayFormat.format(new Date(lead.arrivedAt))}
              </span>
              <StageChip stage={lead.stage} />
            </header>
            <LeadAsked lead={lead} />
            <div className="space-y-3">
              <FieldHeading>Chat</FieldHeading>
              <LeadChat messages={lead.messages} customerName={customer?.name ?? ""} />
              <SendOnThumbtack negotiationId={lead.negotiationId} />
            </div>
          </li>
        ))}
      </ol>
    </HubSection>
  );
}
