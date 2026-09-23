// Turning a Site's address into the Washington sales tax rate a Proposal
// charges (CONTEXT.md, **Sales Tax**). Everything the Department of Revenue's
// address service can say — and every way it can mislead — is decided here;
// convex/salesTax.ts holds the fetch and the Site read, and no rules.
//
// Ported from FRSG's shared/wa-sales-tax.ts. It is kept free of Convex imports
// because that is what lets the whole case matrix be exercised from recorded
// bytes.
//
// The full study of the service, with the live responses these rules were
// written from, is FRSG's docs/research/wa-tax-rate-lookup.md. Three of its
// findings decide the shape of this module:
//
//   - A real address comes back as result code 2, not 0. Accepting only 0
//     rejects nearly every Site.
//   - An address DOR cannot find comes back as HTTP 200 with a plausible rate
//     for the 5-digit ZIP's centroid. Only result code 5 tells them apart, and
//     a wrong rate that looks right is worse than no rate at all.
//   - A request the WAF dislikes is answered with an HTML block page under
//     HTTP 200, so `response.ok` proves nothing. The service's own problems
//     are never allowed to become a verdict about the address.

export const AddressRatesEndpoint = "https://webgis.dor.wa.gov/webapi/AddressRates.aspx";

// The Site fields the lookup reads. A Site from Google may still arrive with
// an empty city, postal code or state, so each is allowed to be missing here.
export type WaSalesTaxAddress = {
  addressLine1: string;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};

// The bytes as the fetch saw them. The content type and the status are part of
// the answer, not plumbing: the block page is invisible without them.
export type AddressRatesReply = {
  status: number;
  contentType: string | null;
  body: string;
};

// Rates are decimals of the whole (0.089), never percents; the caller
// multiplies whole-dollar cents and rounds once.
export type WaSalesTaxRate = {
  outcome: "rate";
  rate: number;
  // Four zero-padded digits. The durable key: it re-derives the rate in a later
  // quarter from DOR's 23 KB rate table with no second address lookup, which
  // the rate alone cannot do.
  locationCode: string;
  locationName: string | null;
  // The quarter this rate belongs to, "Q32026". Absent from some documents, so
  // a Proposal that stores it may find it null.
  period: string | null;
  stateRate: number | null;
  localRate: number | null;
  // Kept so a match can be told from the ZIP-centroid trap forever, not only at
  // lookup time.
  resultCode: number;
};

// Every way this can fail to be an answer about the address, named once here
// so the action cannot invent a fault word the callers have never heard of.
// The two parameterised arms carry DOR's own numbers: the HTTP status, and a
// result code that says something about the request or the service rather than
// the address.
export type WaSalesTaxFault =
  | "SITE_NOT_FOUND"
  | "REQUEST_FAILED"
  | "NOT_XML"
  | "MISSING_RESPONSE"
  | "MISSING_RESULT_CODE"
  | "MISSING_LOCCODE"
  | "MISSING_RATE"
  | `HTTP_${number}`
  | `RESULT_CODE_${number}`;

export type WaSalesTaxResult =
  | WaSalesTaxRate
  // The Site is not in Washington, so no tax line is charged at all.
  | { outcome: "noTax"; reason: "outsideWashington" }
  // Washington, but no rate: the caller offers to take one by hand.
  | {
      outcome: "noRate";
      reason: "addressNotFound" | "addressIncomplete";
      resultCode: number | null;
    }
  // DOR's problem, not the address's. Nothing may be written from this.
  | { outcome: "fault"; fault: WaSalesTaxFault };

// 0 found, 1 ZIP+4 located, 2 updated and found, 3 updated and ZIP+4 located,
// 4 corrected and found. All five place the address on a real location code.
const FoundResultCodes = [0, 1, 2, 3, 4];

// 5 substitutes the 5-digit ZIP's centroid for an address it could not find;
// 6 found nothing at all. Neither is a rate, and 5 is the dangerous one because
// it arrives fully populated.
const NotFoundResultCodes = [5, 6];

// Washington as a Site can spell it. Anything else — Oregon, a blank field —
// is not looked up: DOR answers an out-of-state address with result code 9,
// which is also its code for "internal error", so the branch cannot be made
// from the reply.
const WashingtonNames = ["wa", "washington"];

// Exported because "is this Site taxed at all" is one question with one
// answer: a Proposal's tax record is created from it (convex/proposals.ts),
// and a second spelling of Washington living there would be a second rule.
export function isWashingtonRegion(region: string | null | undefined): boolean {
  const name = region?.trim().toLowerCase().replaceAll(".", "") ?? "";
  return WashingtonNames.includes(name);
}

// DOR's stated input contract, which appears nowhere in its documentation and
// only in the hint it returns when you break it: addr, and city or zip.
function isLookupReady(address: WaSalesTaxAddress): boolean {
  return (
    address.addressLine1.trim().length > 0 &&
    ((address.city?.trim().length ?? 0) > 0 || (address.postalCode?.trim().length ?? 0) > 0)
  );
}

// ver=1 is pinned rather than left to the server's default: the service already
// redirects a version-less request to a version, and its undocumented ver=2
// renames the result attribute. output=xml because the two services' text
// formats disagree with their own specification.
export function addressRatesUrl(address: WaSalesTaxAddress): string {
  const query = [
    "ver=1",
    "output=xml",
    `addr=${encodeURIComponent(address.addressLine1.trim())}`,
    `city=${encodeURIComponent(address.city?.trim() ?? "")}`,
    `zip=${encodeURIComponent(address.postalCode?.trim() ?? "")}`,
  ].join("&");

  return `${AddressRatesEndpoint}?${query}`;
}

export async function lookUpWaSalesTax(
  address: WaSalesTaxAddress,
  fetchRates: (url: string) => Promise<AddressRatesReply>,
): Promise<WaSalesTaxResult> {
  if (!isWashingtonRegion(address.region)) {
    return { outcome: "noTax", reason: "outsideWashington" };
  }

  if (!isLookupReady(address)) {
    return { outcome: "noRate", reason: "addressIncomplete", resultCode: null };
  }

  let reply: AddressRatesReply;
  try {
    reply = await fetchRates(addressRatesUrl(address));
  } catch {
    return { outcome: "fault", fault: "REQUEST_FAILED" };
  }

  return readAddressRates(reply);
}

export function readAddressRates(reply: AddressRatesReply): WaSalesTaxResult {
  if (reply.status < 200 || reply.status >= 300) {
    return { outcome: "fault", fault: `HTTP_${reply.status}` };
  }

  // The block page's whole tell: HTTP 200, and HTML where XML was promised.
  if (!reply.contentType?.toLowerCase().includes("xml")) {
    return { outcome: "fault", fault: "NOT_XML" };
  }

  const response = attributesOf(reply.body, "response");
  if (!response) return { outcome: "fault", fault: "MISSING_RESPONSE" };

  const resultCode = readInteger(response.code);
  if (resultCode === null) return { outcome: "fault", fault: "MISSING_RESULT_CODE" };

  if (NotFoundResultCodes.includes(resultCode)) {
    return { outcome: "noRate", reason: "addressNotFound", resultCode };
  }

  // Codes 7 and 9, and anything DOR adds later, say something about the request
  // or the service — never about the address.
  if (!FoundResultCodes.includes(resultCode)) {
    return { outcome: "fault", fault: `RESULT_CODE_${resultCode}` };
  }

  const locationCode = readLocationCode(response.loccode);
  if (!locationCode) return { outcome: "fault", fault: "MISSING_LOCCODE" };

  const rate = readRate(response.rate);
  if (rate === null) return { outcome: "fault", fault: "MISSING_RATE" };

  const addressLine = attributesOf(reply.body, "addressline");
  const rateLine = attributesOf(reply.body, "rate");

  return {
    outcome: "rate",
    rate,
    locationCode,
    locationName: rateLine?.name?.trim() || null,
    period: addressLine?.period?.trim() || null,
    stateRate: readRate(rateLine?.staterate),
    localRate: readRate(rateLine?.localrate),
    resultCode,
  };
}

// DOR writes the location code unpadded in one quarter and zero-padded in the
// next, so two quarters of the same Proposal would not join without this. A
// "-1" placeholder from a failed lookup is not a code.
function readLocationCode(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  return trimmed.padStart(4, "0");
}

// Rates come back as leading-dot decimal strings (".098"), at a precision that
// varies between calls. Negative values are DOR's failure placeholder.
function readRate(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return null;

  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : null;
}

function readInteger(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? "";
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

// A four-element document with no nesting to speak of, read with a regular
// expression rather than a parser: neither the Convex runtime nor the two
// frontends share an XML parser, and pulling in one for 380 bytes would be the
// larger risk. Attributes are read per element because `code` and `localrate`
// each appear on more than one of them meaning different things.
function attributesOf(xml: string, tag: string): Record<string, string> | null {
  const element = new RegExp(`<${tag}\\b([^>]*)>`, "i").exec(xml);
  if (!element) return null;

  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g;

  let attribute = pattern.exec(element[1]);
  while (attribute !== null) {
    attributes[attribute[1].toLowerCase()] = attribute[2];
    attribute = pattern.exec(element[1]);
  }

  return attributes;
}
