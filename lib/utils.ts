import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/\[CONVEX[^\]]*\]\s*/g, "")
    : "Something went wrong. Please try again.";
}
export function dateTime(value?: number) {
  return value ? new Date(value).toLocaleString() : "—";
}
export function duration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes} min`;
  const rest = minutes % 60;
  return `${hours} hr${rest ? ` ${rest} min` : ""}`;
}
