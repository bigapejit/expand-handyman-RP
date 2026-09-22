import { internalMutation } from "./_generated/server";
import { customerDetails } from "./documents";

// One transaction can only read and write so much, so the backfill takes a
// bounded page at a time. Freezing a document removes it from the next page,
// so there is no cursor to carry: run until it reports done.
const PAGE = 200;

// One-off. Documents issued before customer details were frozen carry no copy of
// the customer's name and site, so they would still follow a renamed customer.
// Freeze them as they stand today. Drafts are left alone: they are meant to read
// the live customer until their link is issued.
export const backfillCustomerDetails = internalMutation({
  args: {},
  handler: async (ctx) => {
    const page = await ctx.db
      .query("documents")
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "draft"),
          q.eq(q.field("customerName"), undefined),
        ),
      )
      .take(PAGE);
    for (const d of page)
      await ctx.db.patch(d._id, await customerDetails(ctx, d));
    return { frozen: page.length, done: page.length < PAGE };
  },
});
