import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
  });
  const stranger = t.withIdentity({
    subject: "someone",
    email: "someone@example.com",
    emailVerified: true,
  });
  // Sites come from Google through sites.add; a photo only needs one to
  // exist, so it is written straight in.
  const site = (name = "4410") =>
    t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        name: "Maria Delgado",
        email: "maria@example.com",
        phone: "",
      });
      return ctx.db.insert("sites", {
        customerId,
        name,
        addressLine1: `${name} Main St`,
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: `place-${name}`,
        latitude: 0,
        longitude: 0,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      });
    });
  // A file as the browser uploads one. convex-test keeps no content type on a
  // stored file, so the one the upload names is written on after.
  const file = (content: string, contentType = "image/jpeg") =>
    t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([content], { type: contentType }));
      await ctx.db.patch(id as never, { contentType } as never);
      return id;
    });
  const url = (id: Id<"_storage">) => t.run((ctx) => ctx.storage.getUrl(id));
  // Both files up, then the save, as the Photos tab does it.
  const photo = async (siteId: Id<"sites">, name: string, takenAt?: number) => {
    const fullId = await file(`${name} full`);
    const thumbId = await file(`${name} thumb`);
    const photoId = await owner.mutation(api.photos.add, {
      siteId,
      fullId,
      thumbId,
      width: 2000,
      height: 1500,
      takenAt,
    });
    return { photoId, fullId, thumbId };
  };
  return { t, owner, stranger, site, file, url, photo };
}

describe("photos.add", () => {
  test("saves the photo on its site with the upload time, and the camera time when there is one", async () => {
    const { owner, site, file, url } = fixture();
    const siteId = await site();
    const fullId = await file("porch full");
    const thumbId = await file("porch thumb");
    const before = Date.now();
    await owner.mutation(api.photos.add, {
      siteId,
      fullId,
      thumbId,
      width: 1500,
      height: 2000,
      takenAt: 1_000,
    });
    const [saved] = await owner.query(api.photos.forSite, { siteId });
    expect(saved).toMatchObject({
      width: 1500,
      height: 2000,
      takenAt: 1_000,
      thumbUrl: await url(thumbId),
      fullUrl: await url(fullId),
    });
    expect(saved.addedAt).toBeGreaterThanOrEqual(before);
    expect(saved.addedAt).toBeLessThanOrEqual(Date.now());
  });

  test("refuses a site that does not exist", async () => {
    const { t, owner, site, file } = fixture();
    const siteId = await site();
    await t.run((ctx) => ctx.db.delete(siteId));
    await expect(
      owner.mutation(api.photos.add, {
        siteId,
        fullId: await file("full"),
        thumbId: await file("thumb"),
        width: 2000,
        height: 1500,
      }),
    ).rejects.toThrow("Site not found.");
  });

  test("refuses until both files are up", async () => {
    const { t, owner, site, file } = fixture();
    const siteId = await site();
    const fullId = await file("full");
    const gone = await file("thumb");
    await t.run((ctx) => ctx.storage.delete(gone));
    for (const [full, thumb] of [
      [fullId, gone],
      [gone, fullId],
    ])
      await expect(
        owner.mutation(api.photos.add, {
          siteId,
          fullId: full,
          thumbId: thumb,
          width: 2000,
          height: 1500,
        }),
      ).rejects.toThrow("The photo's file didn't arrive. Try again.");
    expect(await owner.query(api.photos.forSite, { siteId })).toEqual([]);
  });

  test("refuses a file that is not a JPEG", async () => {
    const { owner, site, file } = fixture();
    const siteId = await site();
    await expect(
      owner.mutation(api.photos.add, {
        siteId,
        fullId: await file("%PDF", "application/pdf"),
        thumbId: await file("thumb"),
        width: 2000,
        height: 1500,
      }),
    ).rejects.toThrow("A photo must be saved as a JPEG.");
  });

  test("refuses one file standing in for both", async () => {
    const { owner, site, file } = fixture();
    const siteId = await site();
    const only = await file("both");
    await expect(
      owner.mutation(api.photos.add, {
        siteId,
        fullId: only,
        thumbId: only,
        width: 2000,
        height: 1500,
      }),
    ).rejects.toThrow("A photo needs its full image and its thumbnail.");
  });

  test("refuses a full image larger than the browser makes", async () => {
    const { owner, site, file } = fixture();
    const siteId = await site();
    for (const [width, height] of [
      [4000, 3000],
      [0, 1500],
      [1999.5, 1500],
    ])
      await expect(
        owner.mutation(api.photos.add, {
          siteId,
          fullId: await file(`full ${width}`),
          thumbId: await file(`thumb ${width}`),
          width,
          height,
        }),
      ).rejects.toThrow("A photo is at most 2000 pixels on a side.");
  });

  test("turns away anyone who is not the owner", async () => {
    const { t, owner, stranger, site, file } = fixture();
    const siteId = await site();
    const args = {
      siteId,
      fullId: await file("full"),
      thumbId: await file("thumb"),
      width: 2000,
      height: 1500,
    };
    for (const caller of [t, stranger])
      await expect(caller.mutation(api.photos.add, args)).rejects.toThrow(
        "Owner access required",
      );
    expect(await owner.query(api.photos.forSite, { siteId })).toEqual([]);
  });
});

describe("photos.forSite", () => {
  test("gives the site's photos newest first by the time each shows, each with both files' URLs", async () => {
    const { owner, site, url, photo } = fixture();
    const siteId = await site();
    // An old library pick, a camera shot with no camera time, and a pick
    // whose camera time is later than both uploads.
    const old = await photo(siteId, "old", 1_000);
    const shot = await photo(siteId, "shot");
    const latest = await photo(siteId, "latest", Date.now() + 60_000);
    // Another site's photo is not this site's.
    await photo(await site("1215"), "elsewhere");

    const photos = await owner.query(api.photos.forSite, { siteId });
    expect(photos.map((row) => row._id)).toEqual([
      latest.photoId,
      shot.photoId,
      old.photoId,
    ]);
    expect(photos[1].takenAt).toBeUndefined();
    for (const [row, saved] of [
      [photos[0], latest],
      [photos[1], shot],
      [photos[2], old],
    ] as const) {
      expect(row.thumbUrl).toBe(await url(saved.thumbId));
      expect(row.fullUrl).toBe(await url(saved.fullId));
      expect(row.thumbUrl).not.toBe(row.fullUrl);
    }
  });

  test("is empty for a site with no photos", async () => {
    const { owner, site } = fixture();
    expect(await owner.query(api.photos.forSite, { siteId: await site() })).toEqual([]);
  });

  test("turns away anyone who is not the owner", async () => {
    const { t, stranger, site, photo } = fixture();
    const siteId = await site();
    await photo(siteId, "porch");
    for (const caller of [t, stranger])
      await expect(caller.query(api.photos.forSite, { siteId })).rejects.toThrow(
        "Owner access required",
      );
  });
});

describe("photos.remove", () => {
  test("deletes the photo and both its files, so their URLs stop working", async () => {
    const { owner, site, url, photo } = fixture();
    const siteId = await site();
    const gone = await photo(siteId, "gone");
    const kept = await photo(siteId, "kept");
    await owner.mutation(api.photos.remove, { photoId: gone.photoId });
    expect(await url(gone.fullId)).toBeNull();
    expect(await url(gone.thumbId)).toBeNull();
    expect(await url(kept.fullId)).not.toBeNull();
    const photos = await owner.query(api.photos.forSite, { siteId });
    expect(photos.map((row) => row._id)).toEqual([kept.photoId]);
  });

  test("leaves a photo already gone be", async () => {
    const { owner, site, photo } = fixture();
    const { photoId } = await photo(await site(), "twice");
    await owner.mutation(api.photos.remove, { photoId });
    await owner.mutation(api.photos.remove, { photoId });
  });

  test("turns away anyone who is not the owner", async () => {
    const { t, owner, stranger, site, url, photo } = fixture();
    const siteId = await site();
    const { photoId, fullId } = await photo(siteId, "porch");
    for (const caller of [t, stranger])
      await expect(caller.mutation(api.photos.remove, { photoId })).rejects.toThrow(
        "Owner access required",
      );
    expect(await owner.query(api.photos.forSite, { siteId })).toHaveLength(1);
    expect(await url(fullId)).not.toBeNull();
  });
});
