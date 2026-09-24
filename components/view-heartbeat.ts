"use client";

import { useEffect, type RefObject } from "react";

import { sendSeenBeacon } from "@/lib/files";

// How long a signing-link view lasts (ADR 0001): a heartbeat every 20 seconds
// while the tab is visible, and a beacon when it is hidden or closed. The view
// itself is logged by the page once what it shows has arrived; this only keeps
// it counting.
export function useViewHeartbeat<ViewId extends string>(
  view: RefObject<ViewId | null>,
  token: string,
  seen: (args: { viewId: ViewId; token: string }) => Promise<unknown>,
) {
  useEffect(() => {
    const beat = () => {
      if (view.current && document.visibilityState === "visible")
        void seen({ viewId: view.current, token }).catch(() => {});
    };
    const close = () => {
      if (view.current) sendSeenBeacon(view.current, token);
    };
    const onVisibility = () =>
      document.visibilityState === "visible" ? beat() : close();
    const timer = setInterval(beat, 20000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", close);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", close);
      // The page can go without the tab going: a link withdrawn or re-sent
      // while it is open swaps it for "no longer live". The time since the
      // last heartbeat was still read, so it is sent now.
      close();
    };
  }, [view, seen, token]);
}
