import { describe, expect, it, vi } from "vitest";

import {
  AddressRatesEndpoint,
  addressRatesUrl,
  lookUpWaSalesTax,
  readAddressRates,
  type AddressRatesReply,
} from "./wa-sales-tax";

// Every fixture below is a document DOR's live service actually returned on
// 2026-09-02, quoted byte for byte in FRSG's docs/research/wa-tax-rate-lookup.md. The
// two exceptions are called out where they sit.

// §1.4 — DOR's own example address. Note the result code: a perfectly good
// address comes back "2", not "0".
const tumwaterFound = `<?xml version="1.0" encoding="utf-8"?><response loccode="3406" localrate=".033" rate=".098" code="2" xmlns=""><addressline code="3406" street="LINDERSON WAY SW" househigh="6500" houselow="6500" evenodd="E" state="WA" zip="98501" plus4="6561" period="Q32026" rta="N" ptba="Thurston PTBA" cez="" /><rate name="TUMWATER" code="3406" staterate=".065" localrate=".033" /></response>`;

// §1.4 recorded this address as loccode 0605 "VANCOUVER" rate .089; the
// document around those values is the shape above with code="0", which is the
// result code DOR documents as a clean hit but rarely sends.
const vancouverFound = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="0" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

// The same Vancouver answer with the location code written unpadded, the way
// §4.1 found DOR writing it in one quarter and not the next.
const vancouverUnpaddedCode = vancouverFound.replaceAll('"0605"', '"605"');

// §5.1 — an address that does not exist, answered with a fully populated and
// entirely plausible rate for the 5-digit ZIP's centroid. Only code="5" tells.
const zipCentroidGuess = `<?xml version="1.0" encoding="utf-8"?><response loccode="3400" localrate=".019" rate=".084" code="5" xmlns=""><addressline code="3400" street="NOWHERE FAKE RD" househigh="9999" houselow="9999" evenodd="O" state="WA" zip="98501" period="Q32026" rta="N" ptba="" cez="" /><rate name="THURSTON COUNTY" code="3400" staterate=".065" localrate=".019" /></response>`;

// §5.2 — a Portland address. "Internal error" per DOR's table, with the real
// explanation only in an undocumented hint.
const outOfState = `<?xml version="1.0" encoding="UTF-8" ?><response loccode="-1" localrate="-1" rate="-1" code="9" debughint="Zipcode is invalid for WA State." />`;

// §5.4 — the WAF's block page, served as HTTP 200.
const blockPage = `<html><head><title>Request Rejected</title></head><body>The system has detected an issue with your request and cannot be completed. Unique Support Id: 6f3c0f1e-2a7e-4d0c-9b6a-1c2d3e4f5a6b</body></html>`;

function xmlReply(body: string): AddressRatesReply {
  return { status: 200, contentType: "text/xml; charset=utf-8", body };
}

const vancouverSite = {
  addressLine1: "1300 Franklin St",
  city: "Vancouver",
  region: "WA",
  postalCode: "98660",
};

describe("Asking DOR for a rate", () => {
  it("pins ver=1 and xml, and sends the address the way DOR's contract requires", () => {
    expect(addressRatesUrl(vancouverSite)).toBe(
      `${AddressRatesEndpoint}?ver=1&output=xml&addr=1300%20Franklin%20St&city=Vancouver&zip=98660`,
    );
  });

  // DOR's own examples call with an empty city, and its error hint states the
  // contract: addr, and city or zip.
  it("still sends the empty parameter when the Site has no city", () => {
    expect(addressRatesUrl({ ...vancouverSite, city: undefined })).toBe(
      `${AddressRatesEndpoint}?ver=1&output=xml&addr=1300%20Franklin%20St&city=&zip=98660`,
    );
  });
});

describe("Reading DOR's answer", () => {
  it("takes a documented clean hit", () => {
    expect(readAddressRates(xmlReply(vancouverFound))).toEqual({
      outcome: "rate",
      rate: 0.089,
      locationCode: "0605",
      locationName: "VANCOUVER",
      period: "Q32026",
      stateRate: 0.065,
      localRate: 0.024,
      resultCode: 0,
    });
  });

  // The load-bearing one: only accepting code 0 would reject nearly every real
  // Site, DOR's own example address included.
  it("takes an updated-and-found hit, which is what a real address returns", () => {
    expect(readAddressRates(xmlReply(tumwaterFound))).toEqual({
      outcome: "rate",
      rate: 0.098,
      locationCode: "3406",
      locationName: "TUMWATER",
      period: "Q32026",
      stateRate: 0.065,
      localRate: 0.033,
      resultCode: 2,
    });
  });

  it("zero-pads a location code DOR wrote short", () => {
    const result = readAddressRates(xmlReply(vancouverUnpaddedCode));
    expect(result).toMatchObject({ outcome: "rate", locationCode: "0605" });
  });

  // The rate is plausible and the address is fiction. Refusing it is the whole
  // point of reading the result code.
  it("refuses the ZIP-centroid guess", () => {
    expect(readAddressRates(xmlReply(zipCentroidGuess))).toEqual({
      outcome: "noRate",
      reason: "addressNotFound",
      resultCode: 5,
    });
  });

  it("refuses an address DOR could not place at all", () => {
    const notFound = zipCentroidGuess.replace('code="5"', 'code="6"');
    expect(readAddressRates(xmlReply(notFound))).toEqual({
      outcome: "noRate",
      reason: "addressNotFound",
      resultCode: 6,
    });
  });

  // Code 9 means "Oregon" and "DOR is broken" with equal authority, so it is
  // never a verdict about the address.
  it("treats the overloaded error code as a fault, not an answer", () => {
    expect(readAddressRates(xmlReply(outOfState))).toEqual({
      outcome: "fault",
      fault: "RESULT_CODE_9",
    });
  });

  it("catches the block page that arrives as a healthy 200", () => {
    expect(
      readAddressRates({ status: 200, contentType: "text/html", body: blockPage }),
    ).toEqual({ outcome: "fault", fault: "NOT_XML" });
  });

  it("refuses a rate it cannot key to a location code", () => {
    const noLocCode = tumwaterFound.replace(' loccode="3406"', "");
    expect(readAddressRates(xmlReply(noLocCode))).toEqual({
      outcome: "fault",
      fault: "MISSING_LOCCODE",
    });
  });

  it("refuses a document carrying no result code", () => {
    const noCode = tumwaterFound.replace(' code="2" xmlns=""', ' xmlns=""');
    expect(readAddressRates(xmlReply(noCode))).toEqual({
      outcome: "fault",
      fault: "MISSING_RESULT_CODE",
    });
  });

  it("refuses a rate with no figure on it", () => {
    const noRate = tumwaterFound.replace(' rate=".098"', "");
    expect(readAddressRates(xmlReply(noRate))).toEqual({
      outcome: "fault",
      fault: "MISSING_RATE",
    });
  });

  // XML that parses to nothing DOR would have sent: a proxy's error document,
  // or a body truncated mid-flight.
  it("refuses a document with no response element at all", () => {
    expect(readAddressRates(xmlReply("<?xml version=\"1.0\"?><error />"))).toEqual({
      outcome: "fault",
      fault: "MISSING_RESPONSE",
    });
  });

  it("treats DOR's documented 500 as a fault", () => {
    expect(readAddressRates({ status: 500, contentType: null, body: "" })).toEqual({
      outcome: "fault",
      fault: "HTTP_500",
    });
  });
});

describe("Looking up a Site's rate", () => {
  it("answers a Washington Site with the rate DOR gave", async () => {
    const fetchRates = vi.fn(async () => xmlReply(vancouverFound));

    await expect(lookUpWaSalesTax(vancouverSite, fetchRates)).resolves.toMatchObject({
      outcome: "rate",
      rate: 0.089,
      locationCode: "0605",
      period: "Q32026",
    });
    expect(fetchRates).toHaveBeenCalledWith(addressRatesUrl(vancouverSite));
  });

  it("reads a spelled-out state the same as its postal abbreviation", async () => {
    const fetchRates = vi.fn(async () => xmlReply(vancouverFound));

    await expect(
      lookUpWaSalesTax({ ...vancouverSite, region: "washington" }, fetchRates),
    ).resolves.toMatchObject({ outcome: "rate" });
  });

  // An Oregon ZIP is answered with the overloaded code 9, so the branch happens
  // here rather than being read back out of DOR's reply.
  it("answers an Oregon Site with no tax and never calls DOR", async () => {
    const fetchRates = vi.fn(async () => xmlReply(vancouverFound));

    await expect(
      lookUpWaSalesTax(
        {
          addressLine1: "1221 SW 4th Ave",
          city: "Portland",
          region: "OR",
          postalCode: "97204",
        },
        fetchRates,
      ),
    ).resolves.toEqual({ outcome: "noTax", reason: "outsideWashington" });
    expect(fetchRates).not.toHaveBeenCalled();
  });

  it("answers a Site with no state at all the same way", async () => {
    const fetchRates = vi.fn(async () => xmlReply(vancouverFound));

    await expect(
      lookUpWaSalesTax({ addressLine1: "123 Main St" }, fetchRates),
    ).resolves.toEqual({ outcome: "noTax", reason: "outsideWashington" });
    expect(fetchRates).not.toHaveBeenCalled();
  });

  // DOR needs addr and one of city or zip; on sites both of those are optional.
  it("asks for nothing when the Site's address is too thin to look up", async () => {
    const fetchRates = vi.fn(async () => xmlReply(vancouverFound));

    await expect(
      lookUpWaSalesTax({ addressLine1: "1300 Franklin St", region: "WA" }, fetchRates),
    ).resolves.toEqual({ outcome: "noRate", reason: "addressIncomplete", resultCode: null });
    expect(fetchRates).not.toHaveBeenCalled();
  });

  it("turns an unreachable service into a fault, never a rate", async () => {
    const fetchRates = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    await expect(lookUpWaSalesTax(vancouverSite, fetchRates)).resolves.toEqual({
      outcome: "fault",
      fault: "REQUEST_FAILED",
    });
  });
});
