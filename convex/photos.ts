import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import { FULL_LONG_EDGE, photoShownAt } from "../lib/photos";

// A site's **Photos** (CONTEXT.md; ADR 0003). The browser shrinks each picture
// to two JPEGs and uploads both through the owner's upload URL (`uploadUrl`);
// only then is the photo saved here. Owner-only
// throughout: a storage URL reads its file for anyone who holds it, so the
// URLs leave only through the owner's own query, and a deleted photo's files
// go with it so its URLs stop working.

// Where the browser puts each shrunk JPEG before `add` records it.
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

// The Photos tab: the site's photos, the newest by the time each shows first,
// each with its thumbnail for the grid and its full image for the dialog.
export const forSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_site", (q) => q.eq("siteId", a.siteId))
      .collect();
    return Promise.all(
      photos
        .sort((x, y) => photoShownAt(y) - photoShownAt(x) || y._creationTime - x._creationTime)
        .map(async (photo) => ({
          _id: photo._id,
          width: photo.width,
          height: photo.height,
          addedAt: photo.addedAt,
          takenAt: photo.takenAt,
          // Null only for a file gone from storage, which the tile shows as
          // an empty square rather than a broken image.
          thumbUrl: await ctx.storage.getUrl(photo.thumbId),
          fullUrl: await ctx.storage.getUrl(photo.fullId),
        })),
    );
  },
});

// Saves a photo once both of its files are up. The files must be the JPEGs
// the browser made, so a stray upload or a PDF never becomes a photo; the
// upload time is the server's, and the camera time is whatever the original
// file carried.
export const add = mutation({
  args: {
    siteId: v.id("sites"),
    fullId: v.id("_storage"),
    thumbId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    takenAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    if (!(await ctx.db.get(a.siteId))) throw new Error("Site not found.");
    if (a.fullId === a.thumbId) throw new Error("A photo needs its full image and its thumbnail.");
    for (const id of [a.fullId, a.thumbId]) {
      const file = await ctx.db.system.get("_storage", id);
      if (!file) throw new Error("The photo's file didn't arrive. Try again.");
      if (file.contentType !== "image/jpeg") throw new Error("A photo must be saved as a JPEG.");
    }
    const side = (n: number) => Number.isInteger(n) && n >= 1 && n <= FULL_LONG_EDGE;
    if (!side(a.width) || !side(a.height))
      throw new Error(`A photo is at most ${FULL_LONG_EDGE} pixels on a side.`);
    if (a.takenAt !== undefined && !Number.isFinite(a.takenAt))
      throw new Error("The photo's camera time isn't a time.");
    return ctx.db.insert("photos", {
      siteId: a.siteId,
      fullId: a.fullId,
      thumbId: a.thumbId,
      width: a.width,
      height: a.height,
      addedAt: Date.now(),
      takenAt: a.takenAt,
    });
  },
});

// Delete, from the open photo. Gone for good: the row and both files, so the
// URLs the owner was shown stop working. A photo already gone is left be.
export const remove = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const photo = await ctx.db.get(a.photoId);
    if (photo) await deletePhoto(ctx, photo);
  },
});

/** Every photo of a site and both files of each, for Delete site. */
export async function deleteSitePhotos(ctx: MutationCtx, siteId: Id<"sites">) {
  const photos = await ctx.db
    .query("photos")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  for (const photo of photos) await deletePhoto(ctx, photo);
}

async function deletePhoto(ctx: MutationCtx, photo: Doc<"photos">) {
  for (const id of [photo.fullId, photo.thumbId])
    if (await ctx.db.system.get("_storage", id)) await ctx.storage.delete(id);
  await ctx.db.delete(photo._id);
}
