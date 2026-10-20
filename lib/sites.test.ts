import { describe, expect, it } from "vitest";

import {
  createSiteName,
  siteActivityLabel,
  siteCityLine,
  siteAddressLine,
  siteDeleteRefusal,
  siteStreetLine,
} from "./sites";

describe("createSiteName", () => {
  // FRSG's cases, verbatim.
  it("uses the street number and first street name token", () => {
    expect(createSiteName("123 Main St")).toBe("123MAIN");
    expect(createSiteName("4567 West Lake Avenue")).toBe("4567WEST");
  });

  it("normalizes punctuation out of the generated Site name", () => {
    expect(createSiteName("12-B Oak Rd")).toBe("12BOAK");
  });

  // Expand: a direction word between the number and the street is skipped.
  it("skips a direction word after the street number", () => {
    expect(createSiteName("4410 NE 94th St")).toBe("441094TH");
    expect(createSiteName("16203 SE 21st St")).toBe("1620321ST");
    for (const direction of ["N", "S", "E", "W", "NE", "NW", "SE", "SW"])
      expect(createSiteName(`100 ${direction} Main St`)).toBe("100MAIN");
  });

  it("skips a direction word whatever its case or punctuation", () => {
    expect(createSiteName("4410 ne 94th St")).toBe("441094TH");
    expect(createSiteName("4410 N.E. 94th St")).toBe("441094TH");
  });

  it("keeps a street whose name only starts like a direction", () => {
    expect(createSiteName("1600 Amphitheatre Pkwy")).toBe("1600AMPHITHEATRE");
    expect(createSiteName("12 Nelson Ave")).toBe("12NELSON");
    expect(createSiteName("12 Sea View Rd")).toBe("12SEA");
  });

  it("keeps the direction word when nothing follows it", () => {
    expect(createSiteName("12 N")).toBe("12N");
  });

  it("falls back to the whole line when there is no second word", () => {
    expect(createSiteName("Plaza")).toBe("PLAZA");
  });
});

describe("the paper's two address lines", () => {
  const site = {
    addressLine1: "4410 NE 94th St",
    addressLine2: "Apt 2",
    city: "Vancouver",
    region: "WA",
    postalCode: "98665",
  };

  it("puts the unit on the street line and the ZIP on the city line", () => {
    expect(siteStreetLine(site)).toBe("4410 NE 94th St, Apt 2");
    expect(siteCityLine(site)).toBe("Vancouver, WA 98665");
  });

  it("leaves out the parts a site does not have", () => {
    expect(siteStreetLine({ ...site, addressLine2: "" })).toBe("4410 NE 94th St");
    expect(siteCityLine({ ...site, postalCode: "" })).toBe("Vancouver, WA");
  });

  it("joins both into one line for a card or a map link", () => {
    expect(siteAddressLine(site)).toBe("4410 NE 94th St, Apt 2, Vancouver, WA 98665");
    expect(siteAddressLine({ ...site, addressLine2: "", postalCode: "" })).toBe(
      "4410 NE 94th St, Vancouver, WA",
    );
  });
});

describe("siteActivityLabel", () => {
  const zone = "America/Los_Angeles";
  // Wednesday 23 September 2026, 9:00 in Vancouver, WA.
  const now = new Date("2026-09-23T16:00:00Z").getTime();
  const label = (iso: string) => siteActivityLabel(new Date(iso).getTime(), now, "en-US", zone);

  it("reads Today for anything since midnight, and for a clock running ahead", () => {
    expect(label("2026-09-23T07:30:00Z")).toBe("Today");
    expect(label("2026-09-23T15:59:00Z")).toBe("Today");
    expect(label("2026-09-23T18:00:00Z")).toBe("Today");
  });

  it("reads Yesterday for last night, however few hours back", () => {
    expect(label("2026-09-23T06:30:00Z")).toBe("Yesterday");
    expect(label("2026-09-22T08:00:00Z")).toBe("Yesterday");
  });

  it("counts the days back within the week", () => {
    expect(label("2026-09-21T20:00:00Z")).toBe("2 days ago");
    expect(label("2026-09-17T20:00:00Z")).toBe("6 days ago");
  });

  it("gives a short date from a week back, with the year only when it is not this one", () => {
    expect(label("2026-09-16T20:00:00Z")).toBe("Sep 16");
    expect(label("2026-01-02T20:00:00Z")).toBe("Jan 2");
    expect(label("2025-12-30T20:00:00Z")).toBe("Dec 30, 2025");
  });
});

describe("siteDeleteRefusal", () => {
  it("lets a site with no paperwork go", () => {
    expect(siteDeleteRefusal({ proposals: 0, invoices: 0 })).toBeNull();
  });

  it("names whatever paperwork keeps the site", () => {
    expect(siteDeleteRefusal({ proposals: 2, invoices: 0 })).toBe(
      "This site has proposals, so it can't be deleted.",
    );
    expect(siteDeleteRefusal({ proposals: 0, invoices: 1 })).toBe(
      "This site has invoices, so it can't be deleted.",
    );
    expect(siteDeleteRefusal({ proposals: 1, invoices: 3 })).toBe(
      "This site has proposals and invoices, so it can't be deleted.",
    );
  });
});
