// Where proposal pricing talks to the Washington Department of Revenue, ported
// from FRSG's convex/salesTax.ts. This reads the site and makes the request;
// which sites are looked up, what DOR's answer means, and every fault it can
// end in all live in lib/wa-sales-tax.ts, so the vocabulary is named in one
// place.
//
// The service takes no key and publishes no quota, so there is nothing to read
// from the environment here.

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalQuery, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import {
  lookUpWaSalesTax,
  type AddressRatesReply,
  type WaSalesTaxAddress,
  type WaSalesTaxResult,
} from "../lib/wa-sales-tax";

// A rate, "this site pays no tax", "we could not find a rate — type one in",
// or "DOR could not answer": four different answers, and none of them throws.
// A site that has since been deleted is the service's problem too, not a
// verdict about anybody's address.
export async function lookUpSiteTax(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<WaSalesTaxResult> {
  const address = await ctx.runQuery(internal.salesTax.siteAddress, { siteId });
  if (!address) return { outcome: "fault", fault: "SITE_NOT_FOUND" };
  return lookUpWaSalesTax(address, fetchAddressRates);
}

export const siteAddress = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a): Promise<WaSalesTaxAddress | null> => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) return null;
    return {
      addressLine1: site.addressLine1,
      city: site.city,
      region: site.region,
      postalCode: site.postalCode,
    };
  },
});

// The whole reply travels back, status and content type included: a WAF block
// page is an ordinary 200 carrying HTML, so the decision layer cannot tell it
// from a rate without them.
async function fetchAddressRates(url: string): Promise<AddressRatesReply> {
  const response = await fetch(url);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}
