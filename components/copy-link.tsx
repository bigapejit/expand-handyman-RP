"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

// Handing a customer-facing link over. FRSG has two of them — a Site's Roof
// Report link and a Proposal's per-Contact **Signing Link** — and staff do the
// same thing with both: copy it, then text it, read it down the phone, or hand
// it over on a doorstep (#197).
//
// The clipboard can refuse (an insecure origin, a permission), so the button is
// never the only way to get the link: it is always rendered beside selectable
// text, and a refused copy says so rather than silently doing nothing. Each
// caller lays the two out its own way; what lives here is the behaviour, so a
// copy that fails cannot be loud on one surface and silent on the other.
export function CopyLinkButton({
  url,
  label = "Copy link",
}: {
  url: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => setState("copied"))
            .catch(() => setState("failed"));
        }}
      >
        {state === "copied" ? (
          <Check data-icon="inline-start" aria-hidden className="text-emerald-700" />
        ) : (
          <Copy data-icon="inline-start" aria-hidden />
        )}
        {label}
      </Button>
      <span role="status" aria-live="polite" className="text-xs font-medium">
        {state === "copied" ? (
          <span className="text-emerald-700">Copied</span>
        ) : state === "failed" ? (
          <span className="text-red-700">
            Copy unavailable — select the link and copy it by hand.
          </span>
        ) : null}
      </span>
    </>
  );
}

// The origin the staff app is being served from, for building a link to hand
// over. Empty during the server render, where there is no browser to ask; the
// link appears as soon as the page hydrates.
export function useAppOrigin(): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "",
  );
}

function subscribeToNothing() {
  return () => {};
}
