import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
export async function isOwner(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const ownerId = process.env.OWNER_CLERK_ID;
  // An exact verified email is the bootstrap allowlist until the owner's ID is configured.
  return (
    !!identity &&
    (ownerId
      ? identity.subject === ownerId
      : identity.emailVerified === true &&
        identity.email === process.env.OWNER_EMAIL)
  );
}
export async function requireOwner(ctx: QueryCtx | MutationCtx | ActionCtx) {
  if (!(await isOwner(ctx)))
    throw new Error(
      "Owner access required. Sign in with the authorized account.",
    );
}
