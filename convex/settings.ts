import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireOwner } from "./auth";
import { DefaultZelleTag } from "../lib/expand-business";
import { readZelleTag, ZelleTagRule } from "../lib/pay-now";

// The business's one row of settings (convex/schema.ts, `settings`), edited
// by the owner from the Invoices page's header. There is no Settings page.

// The **Zelle tag** the invoice paper and the Pay sheet name, read at render
// time so a change reaches every paper, sent or not, without a deploy.
export async function zelleTag(ctx: QueryCtx): Promise<string> {
  const settings = await ctx.db.query("settings").first();
  return settings?.zelleTag || DefaultZelleTag;
}

// The settings as the owner reads them, every one with its default filled in.
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return { zelleTag: await zelleTag(ctx) };
  },
});

// The Zelle tag the paper and the Pay sheet tell customers to pay. A blank
// field puts the default back rather than printing nothing; a tag Zelle's own
// rule would refuse (lib/pay-now.ts, `readZelleTag`) is refused here, since
// every customer would be sent to it.
export const setZelleTag = mutation({
  args: { zelleTag: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const typed = a.zelleTag.trim();
    const tag = typed ? readZelleTag(typed) : null;
    if (typed && tag === null)
      throw new ConvexError({ code: "invalid_zelle_tag", message: ZelleTagRule });
    const settings = await ctx.db.query("settings").first();
    const zelle = tag ?? undefined;
    if (settings) await ctx.db.patch(settings._id, { zelleTag: zelle });
    else await ctx.db.insert("settings", { zelleTag: zelle });
  },
});
