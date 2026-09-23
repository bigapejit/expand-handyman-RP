import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
// Convex wraps a thrown message in its function tag, a request id and, in
// development, the stack: `[CONVEX A(x)] [Request ID: 1] Server Error
// Uncaught Error: <message>  at handler ... Called by client`. Keep the message.
export function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Something went wrong. Please try again.";
  // A refusal that names its reasons (a ConvexError) carries the sentence to
  // show in its data, which may still be JSON after passing through an action.
  const said = refusalMessage((error as { data?: unknown }).data);
  if (said) return said;
  const thrown = /Uncaught Error: ([\s\S]*?)(?:\n\s*at |\s*Called by client|$)/.exec(
    error.message,
  );
  return (thrown?.[1] ?? error.message)
    .replace(/\[CONVEX[^\]]*\]\s*/g, "")
    .replace(/\[Request ID: [^\]]*\]\s*/g, "")
    .trim();
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
function refusalMessage(data: unknown): string | null {
  let read = data;
  try {
    while (typeof read === "string") read = JSON.parse(read);
  } catch {
    return typeof data === "string" ? data : null;
  }
  const message =
    typeof read === "object" && read !== null ? (read as { message?: unknown }).message : null;
  return typeof message === "string" && message ? message : null;
}
