"use client";

import { useSyncExternalStore } from "react";

import { pacificDay } from "@/lib/invoice-standing";

// Today as the invoice lists are asked about it: the Pacific calendar day,
// `YYYY-MM-DD` (lib/invoice-standing.ts). Read from this browser's clock and
// looked at again every minute, so a page left open over midnight turns an
// invoice Overdue without a reload. The server asks for the day rather than
// reading its own clock, because a query's answer is kept until what it read
// changes, and midnight is not a change it can see.
export function usePacificToday(): string {
  return useSyncExternalStore(everyMinute, readToday, readToday);
}

function readToday(): string {
  return pacificDay(Date.now());
}

function everyMinute(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}
