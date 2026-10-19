import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireOwner } from "./auth";
import { DefaultZelleTag } from "../lib/expand-business";
import {
  jobMathSettingsFault,
  jobMathSettingsFaultMessage,
  readJobMathSettings,
} from "../lib/job-math";
import { readZelleTag, ZelleTagRule } from "../lib/pay-now";

// The business's one row of settings (convex/schema.ts, `settings`), edited
// by the owner where each is used: the Zelle tag from the Invoices page's
// header, Job math's percentages from the Job math page. There is no Settings
// page.

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
    const settings = await ctx.db.query("settings").first();
    return {
      zelleTag: settings?.zelleTag || DefaultZelleTag,
      jobMath: readJobMathSettings(settings),
    };
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

// **Job math**'s percentages and rates, saved whole from the form that shows
// them all. Refused with the same fault the form words (lib/job-math.ts), so
// nothing the calculator can't divide by is ever stored.
export const setJobMath = mutation({
  args: {
    profitPercent: v.number(),
    marketingPercent: v.number(),
    opsPercent: v.number(),
    ownerTaxPercent: v.number(),
    payrollTaxPercent: v.number(),
    workersCompCentsPerHour: v.number(),
    wageCents: v.number(),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const fault = jobMathSettingsFault(a);
    if (fault)
      throw new ConvexError({ code: fault, message: jobMathSettingsFaultMessage(fault) });
    const settings = await ctx.db.query("settings").first();
    if (settings) await ctx.db.patch(settings._id, a);
    else await ctx.db.insert("settings", a);
  },
});
