import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireOwner } from "./auth";
import { sendableEmail } from "../lib/customer";
import { DefaultZelleEmail } from "../lib/expand-business";

// The business's one row of settings (convex/schema.ts, `settings`), edited
// by the owner from the Invoices page's header. There is no Settings page.

// The Zelle address the invoice paper prints, read at render time so a
// change reaches every paper, sent or not, without a deploy.
export async function zelleEmail(ctx: QueryCtx): Promise<string> {
  const settings = await ctx.db.query("settings").first();
  return settings?.zelleEmail?.trim() || DefaultZelleEmail;
}

// The settings as the owner reads them, every one with its default filled in.
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return { zelleEmail: await zelleEmail(ctx) };
  },
});

// The Zelle address the paper tells customers to pay. A blank field puts the
// default back rather than printing nothing; anything that is not an email
// address is refused, since the paper would print it to every customer.
export const setZelleEmail = mutation({
  args: { zelleEmail: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const typed = a.zelleEmail.trim();
    const email = typed ? sendableEmail(typed) : null;
    if (typed && email === null)
      throw new ConvexError({
        code: "invalid_email",
        message: "Enter an email address, like pay@expandhandyman.com.",
      });
    const settings = await ctx.db.query("settings").first();
    const zelle = email ?? undefined;
    if (settings) await ctx.db.patch(settings._id, { zelleEmail: zelle });
    else await ctx.db.insert("settings", { zelleEmail: zelle });
  },
});
