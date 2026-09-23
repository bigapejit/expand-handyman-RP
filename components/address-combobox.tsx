"use client";

import { useAction } from "convex/react";
import { LoaderCircle, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/utils";
import { MIN_LOOKUP, type PlaceSuggestion } from "@/lib/places";

const DEBOUNCE_MS = 250;
export const PICK_ADDRESS = "Pick an address from the list.";

const label = (place: PlaceSuggestion) =>
  [place.mainText, place.secondaryText].filter(Boolean).join(", ");

/** One session token per lookup: autocomplete and the details call bill as one. */
export function newLookupSession() {
  return crypto.randomUUID();
}

/**
 * Google's address suggestions, fetched through Convex so the key never
 * reaches the browser. Only a picked suggestion is a value: typing clears it,
 * so a form can refuse free text by checking for `null`.
 */
export function AddressCombobox({
  id,
  sessionToken,
  value,
  onChange,
  onTyped,
  disabled,
  invalid,
}: {
  id: string;
  sessionToken: string;
  value: PlaceSuggestion | null;
  onChange: (place: PlaceSuggestion | null) => void;
  /** Whether the box holds text, picked or not. */
  onTyped?: (typed: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const suggest = useAction(api.places.suggest);
  const [text, setText] = useState(value ? label(value) : "");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // The picked place stays in the list so the combobox can show it as chosen.
  const items =
    value && !results.some((r) => r.placeId === value.placeId)
      ? [...results, value]
      : results;

  function lookUp(input: string) {
    clearTimeout(timer.current);
    const request = ++latest.current;
    if (input.trim().length < MIN_LOOKUP) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const found = await suggest({ input, sessionToken });
        if (request !== latest.current) return;
        setResults(found);
        setError("");
      } catch (err) {
        if (request !== latest.current) return;
        setResults([]);
        setError(errorMessage(err));
      } finally {
        if (request === latest.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
  }

  const status = searching
    ? "Searching…"
    : error ||
      (text.trim().length < MIN_LOOKUP ? "Keep typing the street address." : "No matching US address.");

  return (
    <Combobox
      items={items}
      value={value}
      inputValue={text}
      filter={null}
      itemToStringLabel={label}
      isItemEqualToValue={(a, b) => a.placeId === b.placeId}
      disabled={disabled}
      onValueChange={(next) => onChange(next)}
      onInputValueChange={(next, { reason }) => {
        // Closing the list resets the box to the picked label, or empties it
        // when nothing is picked. That would wipe the owner's typing and hide
        // why Save is off, so unpicked text stays until they change it.
        if ((reason === "none" || reason === "input-clear") && !value) return;
        setText(next);
        onTyped?.(next.trim() !== "");
        if (reason === "item-press") return;
        if (value && next !== label(value)) onChange(null);
        lookUp(next);
      }}
    >
      <ComboboxInput
        id={id}
        placeholder="Start typing the street address"
        showTrigger={false}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        className="w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty className="gap-2 px-3">
          {searching ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
          ) : null}
          {status}
        </ComboboxEmpty>
        <ComboboxList>
          {(place: PlaceSuggestion) => (
            <ComboboxItem key={place.placeId} value={place} className="items-start py-2">
              <MapPin aria-hidden className="mt-0.5 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{place.mainText}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {place.secondaryText}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
