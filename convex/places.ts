import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireOwner } from "./auth";
import {
  MAX_LOOKUP,
  MIN_LOOKUP,
  placesKey,
  suggestAddresses,
} from "../lib/places";

// The address combobox's suggestions. The Google key stays on the server and
// only the owner can spend it; the pick itself is looked up when a site saves.
export const suggest = action({
  args: { input: v.string(), sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const input = a.input.trim().slice(0, MAX_LOOKUP);
    if (input.length < MIN_LOOKUP) return [];
    return suggestAddresses(placesKey(), input, checkedSession(a.sessionToken));
  },
});

export function checkedSession(sessionToken: string) {
  if (!/^[\w-]{8,100}$/.test(sessionToken))
    throw new Error("Invalid address lookup session.");
  return sessionToken;
}
