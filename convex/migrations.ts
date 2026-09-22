import { internalMutation } from "./_generated/server";
import { customerDetails } from "./documents";

// One-off. Documents issued before customer details were frozen carry no copy of
// the customer's name and site, so they would still follow a renamed customer.
// Freeze them as they stand today. Drafts are left alone: they are meant to read
// the live customer until their link is issued.
export const backfillCustomerDetails = internalMutation({
  args: {},
  handler: async (ctx) => {
    let frozen = 0;
    for (const d of await ctx.db.query("documents").collect()) {
      if (d.status === "draft") continue;
      if (d.customerName !== undefined && d.site !== undefined) continue;
      await ctx.db.patch(d._id, await customerDetails(ctx, d));
      frozen++;
    }
    return { frozen };
  },
});
