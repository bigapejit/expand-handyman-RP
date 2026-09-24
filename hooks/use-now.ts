"use client";

import { useEffect, useState } from "react";

// The clock a card's age, the **Pipeline**'s flags and the Staff page's "Last
// seen" read from, moved on each minute so they keep up while the page sits
// open.
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
