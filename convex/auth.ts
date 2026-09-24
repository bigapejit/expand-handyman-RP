import { internal } from "./_generated/api";
import { query, type QueryCtx, type MutationCtx, type ActionCtx } from "./_generated/server";

// Who is let into the staff console: every **Staff member** (CONTEXT.md). That
// is, first, the Owner's accounts the deployment pins, which no one can remove
// from the Staff page: the Clerk account in OWNER_CLERK_ID, any account whose
// verified email is listed in OWNER_EMAIL, and on a dev deployment the QA
// account the browser-test seed pins in QA_CLERK_ID. The email list is
// honoured beside the pinned id, not only until it is set, so a seed or a
// re-pin can never lock the owner out of their own deployment. Each variable
// may hold several values separated by commas. Then everyone on the Staff
// page: an account whose verified email has a `staff` row, or whose Clerk id a
// row learned at its first sign-in. Removing the row locks them out on their
// next request. Everyone let in can do everything; there are no roles.
export async function isOwner(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<boolean> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return false;
  const email =
    identity.emailVerified === true && identity.email ? identity.email.toLowerCase() : undefined;
  if (isRoot({ clerkUserId: identity.subject, email })) return true;
  const who = { subject: identity.subject, email };
  // An action has no database of its own and asks through a query.
  return "db" in ctx ? isMember(ctx, who) : ctx.runQuery(internal.staff.isMember, who);
}

// Whether an account is one the deployment pins as the Owner's. Clerk ids are
// case-sensitive (`user_3J6…`); only emails are folded.
export function isRoot(account: { clerkUserId?: string; email?: string }) {
  const ids = list(process.env.OWNER_CLERK_ID).concat(list(process.env.QA_CLERK_ID));
  if (account.clerkUserId && ids.includes(account.clerkUserId)) return true;
  return (
    !!account.email &&
    list(process.env.OWNER_EMAIL)
      .map((e) => e.toLowerCase())
      .includes(account.email.toLowerCase())
  );
}

// Whether a `staff` row names the account. `email` is the verified one,
// lower-cased, or absent when the account has none verified.
export async function isMember(
  ctx: QueryCtx,
  who: { subject: string; email?: string },
): Promise<boolean> {
  if (who.email) {
    const byEmail = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", who.email!))
      .first();
    if (byEmail) return true;
  }
  const byId = await ctx.db
    .query("staff")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", who.subject))
    .first();
  return byId !== null;
}

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function requireOwner(ctx: QueryCtx | MutationCtx | ActionCtx) {
  if (!(await isOwner(ctx)))
    throw new Error(
      "Owner access required. Sign in with the authorized account.",
    );
}

// The staff app's gate: whether the signed-in account is a **Staff member**.
// The sidebar shares the answer to know when its staff-only badges may ask.
export const access = query({
  args: {},
  handler: async (ctx) => ({ owner: await isOwner(ctx) }),
});
