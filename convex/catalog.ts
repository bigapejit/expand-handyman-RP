import { v } from "convex/values";

import { query, type MutationCtx } from "./_generated/server";
import { requireOwner } from "./auth";
import { readLineItemUnit } from "../lib/line-item-units";
import type { SolutionLineItem } from "../lib/solution-pricing";

// The Catalog (CONTEXT.md), ported from FRSG's convex/catalog.ts: what the
// owner has charged for before, remembered from the work itself. Every
// solution save writes its line items here, across every site, and typing a
// line's name reads them back. It is a convenience and nothing more — a
// suggestion taken becomes an ordinary line item with no tie back to the row
// it came from — so there is no list to maintain and nothing to delete.

// A name folded until two spellings of the same line meet: "Drywall Patch",
// "drywall patch", and "Drywall  Patch" are one Catalog row.
export function normalizeCatalogName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// How many suggestions the panel offers under a name being typed. Short
// enough to read without leaving the field.
const SuggestionsLimit = 6;

// How much of the prefix range one query reads before ranking. The Catalog is
// never pruned, so an unbounded scan is not an option; past the bound, ranking
// is by use among the alphabetically first 500, and typing a second letter
// finds anything a one-letter prefix missed.
const SuggestionScanLimit = 500;

// The last character JavaScript can compare, so the range covers every name
// that starts with the prefix and stops before the one that does not.
const AfterEveryString = "￿";

// Names used before that start with what is being typed, the most used first,
// each with what it last cost and was last counted in, so a suggestion taken
// fills a whole line. A blank prefix suggests nothing: the Catalog helps with
// a name in progress and is never a list to browse.
export const suggestions = query({
  args: { prefix: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);

    const prefix = normalizeCatalogName(args.prefix);
    if (prefix.length === 0) return [];

    const matches = await ctx.db
      .query("catalogEntries")
      .withIndex("by_normalized_name", (q) =>
        q.gte("normalizedName", prefix).lt("normalizedName", prefix + AfterEveryString),
      )
      .take(SuggestionScanLimit);

    return matches
      .sort(
        (left, right) =>
          right.useCount - left.useCount ||
          left.normalizedName.localeCompare(right.normalizedName),
      )
      .slice(0, SuggestionsLimit)
      .map((entry) => ({
        name: entry.name,
        lastUnitCostCents: entry.lastUnitCostCents,
        lastUnit: readLineItemUnit(entry.lastUnit),
      }));
  },
});

// Write a solution's line items into the Catalog on every save of its lines.
// A save that names the same line twice counts once and keeps the one written
// last: a save is one act of authorship, not two.
export async function rememberLineItems(
  ctx: MutationCtx,
  lineItems: readonly SolutionLineItem[],
  now: number,
): Promise<void> {
  const written = new Map<string, SolutionLineItem>();
  for (const line of lineItems) {
    const normalizedName = normalizeCatalogName(line.name);
    if (normalizedName.length === 0) continue;
    written.set(normalizedName, line);
  }

  for (const [normalizedName, line] of written) {
    const existing = await ctx.db
      .query("catalogEntries")
      .withIndex("by_normalized_name", (q) => q.eq("normalizedName", normalizedName))
      .first();

    // The spelling, the cost and the unit are always the latest ones: the
    // Catalog suggests what the owner charges now, not what they charged first.
    const latest = {
      name: line.name.trim(),
      lastUnitCostCents: line.unitCostCents,
      lastUnit: readLineItemUnit(line.unit),
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, { ...latest, useCount: existing.useCount + 1 });
    } else {
      await ctx.db.insert("catalogEntries", { normalizedName, ...latest, useCount: 1 });
    }
  }
}
