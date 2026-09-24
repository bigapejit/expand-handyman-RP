import { ConvexError } from "convex/values";

// Clerk's Backend API, called with fetch from the default runtime rather than
// through @clerk/backend, which the Convex functions do not otherwise need.
// Only the Staff page uses it (convex/staff.ts): invitations, the sign-up
// allowlist and deleting a removed staff member's account.

const ClerkApi = "https://api.clerk.com/v1";

export type ClerkFault = { code: "clerk"; status: number; clerkCode: string; message: string };

// One call to Clerk, signed with the deployment's secret key. Anything but a
// 2xx is thrown as a ConvexError carrying Clerk's own words, so the Staff page
// can show them and a caller can tell a 404 from a real fault.
export async function clerk<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const key = process.env.CLERK_SECRET_KEY?.trim();
  if (!key)
    throw new ConvexError({
      code: "not_configured",
      message: "Invitations aren't set up on this deployment yet.",
    });
  const response = await fetch(`${ClerkApi}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;
  const error = (body as { errors?: { code?: string; message?: string; long_message?: string }[] })
    ?.errors?.[0];
  const fault: ClerkFault = {
    code: "clerk",
    status: response.status,
    clerkCode: error?.code ?? "",
    message: error?.long_message || error?.message || `Clerk answered ${response.status}.`,
  };
  throw new ConvexError(fault);
}

// The Clerk fault an error is, or null when it is anything else.
export function clerkFault(error: unknown): ClerkFault | null {
  if (!(error instanceof ConvexError)) return null;
  const data = error.data as Partial<ClerkFault> | null;
  return data?.code === "clerk" ? (data as ClerkFault) : null;
}
