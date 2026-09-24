import { calendarDay } from "./document-lines";

// A Site's address as stored: the parts Google returns, with no formatted
// string beside them. One helper prints it, so every surface reads the same.
export type SiteAddress = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
};

const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

/**
 * FRSG's `createSiteName`, plus Expand's rule: a direction word between the
 * street number and the street is skipped, so `4410 NE 94th St` is `441094TH`.
 */
export function createSiteName(addressLine1: string) {
  const tokens = addressLine1
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  const [streetNumber = "", ...street] = tokens;
  const skip = street.length > 1 && DIRECTIONS.has(street[0]) ? 1 : 0;
  const siteName = `${streetNumber}${street[skip] ?? ""}`;

  return siteName || normalizeToken(addressLine1);
}

function normalizeToken(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** `4410 NE 94th St, Apt 2, Vancouver, WA 98665`, skipping any empty part. */
export function siteAddress(site: SiteAddress) {
  return joinParts([site.addressLine1, site.addressLine2, siteCityLine(site)]);
}

/** The address as the paper prints it over two lines: `4410 NE 94th St, Apt 2`. */
export function siteStreetLine(site: SiteAddress) {
  return joinParts([site.addressLine1, site.addressLine2]);
}

/** …and `Vancouver, WA 98665`. */
export function siteCityLine(site: SiteAddress) {
  const regionLine = joinParts([site.region, site.postalCode], " ");
  return joinParts([site.city, regionLine]);
}

function joinParts(parts: string[], separator = ", ") {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(separator);
}

// What the owner types beside the picked address, and the unit rule the
// duplicate check shares: `Apt 2` and ` apt  2` are the same unit.
export const MAX_UNIT = 100;
export const MAX_ACCESS_NOTES = 1000;

/** The unit line and access notes, trimmed, or a message naming the problem. */
export function parseSiteDetails(details: {
  addressLine2: string;
  accessNotes: string;
}) {
  const addressLine2 = details.addressLine2.trim();
  const accessNotes = details.accessNotes.trim();
  if (addressLine2.length > MAX_UNIT)
    throw new Error("Keep the unit under 100 characters.");
  if (accessNotes.length > MAX_ACCESS_NOTES)
    throw new Error("Keep access notes under 1,000 characters.");
  return { addressLine2, accessNotes };
}

export function sameUnit(a: string, b: string) {
  return unitKey(a) === unitKey(b);
}

function unitKey(unit: string) {
  return unit.trim().replace(/\s+/g, " ").toLowerCase();
}

// When a site was last touched, as the Sites list hint reads it: Today,
// Yesterday, a few days ago, then a short date once it is a week or more back,
// with the year only when it is not this one. Counted in calendar days, so
// last night is Yesterday however few hours ago it was. `now`, the locale and
// the time zone are parameters so a test can pin them; the app passes the
// clock and neither of the others, and gets the owner's own.
export function siteActivityLabel(
  at: number,
  now: number,
  locale?: string,
  timeZone?: string,
) {
  const days = calendarDay(now, timeZone) - calendarDay(at, timeZone);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const year = (when: number) =>
    new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone }).format(when);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: year(at) === year(now) ? undefined : "numeric",
    timeZone,
  }).format(at);
}

// Why a site cannot be deleted, or null when it can. Proposals and invoices
// are paperwork a customer may have seen, so a site holding either stays; the
// Edit site dialog shows this beside a disabled Delete site, and the server
// refuses with it whatever the button said.
export function siteDeleteRefusal(held: { proposals: number; invoices: number }) {
  const what = [
    held.proposals > 0 ? "proposals" : "",
    held.invoices > 0 ? "invoices" : "",
  ].filter(Boolean);
  return what.length
    ? `This site has ${what.join(" and ")}, so it can't be deleted.`
    : null;
}
