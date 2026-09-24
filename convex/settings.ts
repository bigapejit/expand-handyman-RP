import type { QueryCtx } from "./_generated/server";
import { DefaultZelleEmail } from "../lib/expand-business";

// The business's one row of settings (convex/schema.ts, `settings`). Nothing
// writes it yet; the owner's edit of the Zelle address comes with the
// Invoices page.

// The Zelle address the invoice paper prints, read at render time so a
// change reaches every paper, sent or not, without a deploy.
export async function zelleEmail(ctx: QueryCtx): Promise<string> {
  const settings = await ctx.db.query("settings").first();
  return settings?.zelleEmail?.trim() || DefaultZelleEmail;
}
