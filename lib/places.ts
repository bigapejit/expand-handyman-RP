// Google Places API (New), called only from Convex with the server-only
// GOOGLE_MAPS_API_KEY. Autocomplete and the one details call of a lookup share
// a session token, so Google bills them as one session.
import type { SiteAddress } from "./sites";

const PLACES = "https://places.googleapis.com/v1";
// Places (New) has no single "address" type; these three are street addresses,
// buildings and the units inside them.
const ADDRESS_TYPES = ["street_address", "premise", "subpremise"];
export const MIN_LOOKUP = 3;
export const MAX_LOOKUP = 200;

export type PlaceSuggestion = {
  placeId: string;
  mainText: string;
  secondaryText: string;
};

/** A picked place as a Site stores it. The unit line is the owner's to type. */
export type PlaceAddress = Omit<SiteAddress, "addressLine2"> & {
  placeId: string;
  latitude: number;
  longitude: number;
};

export function placesKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key)
    throw new Error(
      "Address lookup is not set up. Set GOOGLE_MAPS_API_KEY on this deployment.",
    );
  return key;
}

export async function suggestAddresses(
  key: string,
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const response = await fetch(`${PLACES}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ["us"],
      includedPrimaryTypes: ADDRESS_TYPES,
    }),
  });
  if (!response.ok) throw lookupFailed(response);
  const body = (await response.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        structuredFormat?: {
          mainText?: { text: string };
          secondaryText?: { text: string };
        };
      };
    }[];
  };
  return (body.suggestions ?? []).flatMap(({ placePrediction: p }) =>
    p
      ? [
          {
            placeId: p.placeId,
            mainText: p.structuredFormat?.mainText?.text ?? "",
            secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
          },
        ]
      : [],
  );
}

/**
 * The details call that closes a lookup's session. A picked apartment also
 * brings its unit, as `#4`, for the owner's unit line when they typed none.
 */
export async function placeAddress(
  key: string,
  placeId: string,
  sessionToken?: string,
): Promise<{ address: PlaceAddress; unit: string }> {
  const url = new URL(`${PLACES}/places/${encodeURIComponent(placeId)}`);
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
  const response = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "id,addressComponents,location",
    },
  });
  if (!response.ok) throw lookupFailed(response);
  const place = (await response.json()) as Place;
  const unit = place.addressComponents?.find((c) => c.types.includes("subpremise"));
  return {
    address: addressFromPlace(place),
    unit: unit ? `#${unit.shortText.replace(/^#/, "")}` : "",
  };
}

type Place = {
  id: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
};

export function addressFromPlace(place: Place): PlaceAddress {
  const part = (type: string, text: "longText" | "shortText" = "longText") =>
    place.addressComponents?.find((c) => c.types.includes(type))?.[text] ?? "";
  const street = [part("street_number"), part("route", "shortText")];
  const city = part("locality") || part("postal_town") || part("sublocality");
  if (part("country", "shortText") !== "US")
    throw new Error("Pick an address in the United States.");
  if (street.some((s) => !s) || !city || !place.location)
    throw new Error("Google has no street address for that place. Pick another.");
  return {
    placeId: place.id,
    addressLine1: street.join(" "),
    city,
    region: part("administrative_area_level_1", "shortText"),
    postalCode: part("postal_code"),
    latitude: place.location.latitude,
    longitude: place.location.longitude,
  };
}

function lookupFailed(response: Response) {
  return new Error(
    `Google address lookup failed (HTTP ${response.status}). Try again.`,
  );
}
