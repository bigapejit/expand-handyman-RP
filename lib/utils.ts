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
