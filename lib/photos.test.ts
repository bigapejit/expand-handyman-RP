import { describe, expect, it } from "vitest";

import { exifTakenAt, fitLongEdge, photoShownAt, photoTimeLabel } from "./photos";

const at = (iso: string) => new Date(iso).getTime();

describe("photoTimeLabel", () => {
  const zone = "America/Los_Angeles";

  it("says Taken with the camera time when the file carried one", () => {
    expect(
      photoTimeLabel(
        { takenAt: at("2026-09-01T17:05:00Z"), addedAt: at("2026-09-23T16:00:00Z") },
        "en-US",
        zone,
      ),
    ).toBe("Taken Sep 1, 2026, 10:05 AM");
  });

  it("says Added with the upload time when it carried none, as an iPhone camera shot does", () => {
    expect(photoTimeLabel({ addedAt: at("2026-09-23T16:00:00Z") }, "en-US", zone)).toBe(
      "Added Sep 23, 2026, 9:00 AM",
    );
  });
});

describe("photoShownAt", () => {
  it("is the camera time when there is one, else the upload time", () => {
    expect(photoShownAt({ takenAt: 1_000, addedAt: 5_000 })).toBe(1_000);
    expect(photoShownAt({ addedAt: 5_000 })).toBe(5_000);
  });
});

describe("exifTakenAt", () => {
  it("reads the camera's offset when it wrote one", () => {
    expect(exifTakenAt("2026:09:01 10:05:00", "-07:00")).toBe(at("2026-09-01T17:05:00Z"));
    expect(exifTakenAt("2026:09:01 10:05:00", "+05:30")).toBe(at("2026-09-01T04:35:00Z"));
  });

  it("reads the time as the phone's own clock without one", () => {
    expect(exifTakenAt("2026:09:01 10:05:00")).toBe(
      new Date(2026, 8, 1, 10, 5, 0).getTime(),
    );
    // An offset that is not one is no offset.
    expect(exifTakenAt("2026:09:01 10:05:00", "")).toBe(
      new Date(2026, 8, 1, 10, 5, 0).getTime(),
    );
  });

  it("finds no camera time in a missing, blank or malformed value", () => {
    for (const value of [
      undefined,
      "",
      "0000:00:00 00:00:00",
      "    :  :     :  :  ",
      "2026-09-01 10:05:00",
      "2026:13:01 10:05:00",
      "2026:09:01 25:05:00",
    ])
      expect(exifTakenAt(value)).toBeUndefined();
  });
});

describe("fitLongEdge", () => {
  it("brings the long edge down and the other side in proportion", () => {
    expect(fitLongEdge(8064, 6048, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitLongEdge(3024, 4032, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitLongEdge(2000, 1500, 400)).toEqual({ width: 400, height: 300 });
  });

  it("never enlarges a picture already small enough", () => {
    expect(fitLongEdge(1200, 900, 2000)).toEqual({ width: 1200, height: 900 });
  });

  it("keeps a sliver at least a pixel wide", () => {
    expect(fitLongEdge(10000, 2, 400)).toEqual({ width: 400, height: 1 });
  });
});
