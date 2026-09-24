import { query, type QueryCtx, type MutationCtx, type ActionCtx } from "./_generated/server";

// Who counts as the Owner (CONTEXT.md): the Clerk account pinned in
// OWNER_CLERK_ID, any account whose verified email is listed in OWNER_EMAIL,
// and on a dev deployment the QA account the browser-test seed pins in
// QA_CLERK_ID. The email list is honoured beside the pinned id, not only until
// it is set, so a seed or a re-pin can never lock the owner out of their own
// deployment. Each variable may hold several values separated by commas.
export async function isOwner(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return false;
  const ids = list(process.env.OWNER_CLERK_ID).concat(list(process.env.QA_CLERK_ID));
  if (ids.includes(identity.subject)) return true;
  return (
    identity.emailVerified === true &&
    !!identity.email &&
    list(process.env.OWNER_EMAIL).includes(identity.email.toLowerCase())
  );
}

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireOwner(ctx: QueryCtx | MutationCtx | ActionCtx) {
  if (!(await isOwner(ctx)))
    throw new Error(
      "Owner access required. Sign in with the authorized account.",
    );
}

// The staff app's gate: whether the signed-in account is the Owner. The
// sidebar shares the answer to know when its owner-only badges may ask.
export const access = query({
  args: {},
  handler: async (ctx) => ({ owner: await isOwner(ctx) }),
});
