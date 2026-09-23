import { describe, expect, it } from "vitest";

import { createSiteName, siteAddress, siteCityLine, siteStreetLine } from "./sites";

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

describe("siteAddress", () => {
  it("prints the street, unit, city, region and ZIP on one line", () => {
    expect(
      siteAddress({
        addressLine1: "4410 NE 94th St",
        addressLine2: "Apt 2",
        city: "Vancouver",
        region: "WA",
        postalCode: "98665",
      }),
    ).toBe("4410 NE 94th St, Apt 2, Vancouver, WA 98665");
  });

  it("leaves out the parts a site does not have", () => {
    expect(
      siteAddress({
        addressLine1: "4410 NE 94th St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "",
      }),
    ).toBe("4410 NE 94th St, Vancouver, WA");
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
});
