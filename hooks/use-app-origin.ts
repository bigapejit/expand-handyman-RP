"use client";

import { useSyncExternalStore } from "react";

// Every customer-facing link FRSG hands out — a Site's Roof Report and a
// Proposal's Signing Link — is a route of this same app, so the absolute URL
// is this app's own origin. It is read from the browser rather than
// configured, and only after hydration: the server has no origin, and a guess
// would hydrate wrong.
//
// The empty string is the server's answer, and the link builders in shared/
// return null for it rather than half a URL.
const neverChanges = () => () => {};

export function useAppOrigin(): string {
  return useSyncExternalStore(
    neverChanges,
    () => window.location.origin,
    () => "",
  );
}
