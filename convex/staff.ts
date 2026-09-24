import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { isMember as memberOf, isRoot, requireOwner } from "./auth";
import { clerk, clerkFault } from "./clerk";
import { appOrigin } from "./email";
import { sendableEmail } from "../lib/customer";

// The Staff page: who is let into the console (CONTEXT.md, **Staff member**),
// and the **Invite** that adds someone. Anyone on the list can invite and
// remove; only the Owner's pinned accounts (convex/auth.ts, `isRoot`) are fixed.

export type StaffMember = {
  _id: Id<"staff">;
  email: string;
  name?: string;
  status: "active" | "invited";
  invitedAt: number;
  lastSeenAt?: number;
  root: boolean;
  you: boolean;
};

// Everyone on the list: those who have signed in, by name, then the invites
// still waiting, oldest first.
export const list = query({
  args: {},
  handler: async (ctx): Promise<StaffMember[]> => {
    await requireOwner(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const me = verifiedEmail(identity);
    const rows = await ctx.db.query("staff").collect();
    const members = rows.map(
      (row): StaffMember => ({
        _id: row._id,
        email: row.email,
        name: row.name,
        status: row.clerkUserId ? "active" : "invited",
        invitedAt: row.invitedAt,
        lastSeenAt: row.lastSeenAt,
        root: rootRow(row),
        you:
          (!!row.clerkUserId && row.clerkUserId === identity?.subject) ||
          (!!me && row.email === me),
      }),
    );
    const active = members
      .filter((m) => m.status === "active")
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
    const invited = members
      .filter((m) => m.status === "invited")
      .sort((a, b) => a.invitedAt - b.invitedAt);
    return [...active, ...invited];
  },
});

// The caller's own row, touched once per page load by the gate. An invitee's
// first sign-in is what moves their row to Has access; the Owner's pinned
// accounts, which nobody invites, get their row here. An account found by its
// Clerk id under another email has changed its address, and the row follows.
// One account keeps one row: a row it held under an old address goes, or
// removing either would delete the Clerk account of someone still listed, or
// leave a removed person let in by the other.
export const seen = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const identity = (await ctx.auth.getUserIdentity())!;
    const email = verifiedEmail(identity);
    const row =
      (email ? await byEmail(ctx, email) : null) ??
      (await holders(ctx, identity.subject))[0] ??
      null;
    const now = Date.now();
    const name = identity.name?.trim() || undefined;
    let keep: Id<"staff"> | undefined = row?._id;
    if (row) {
      await ctx.db.patch(row._id, {
        ...(email ? { email } : {}),
        clerkUserId: identity.subject,
        ...(name ? { name } : {}),
        firstSeenAt: row.firstSeenAt ?? now,
        lastSeenAt: now,
      });
    } else if (email) {
      keep = await ctx.db.insert("staff", {
        email,
        invitedAt: now,
        invitedBy: "",
        clerkUserId: identity.subject,
        name,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
    if (keep)
      for (const stale of await holders(ctx, identity.subject))
        if (stale._id !== keep) await ctx.db.delete(stale._id);
  },
});

// Adds an email to the list and has Clerk send it an **Invite**. The email
// goes on Clerk's sign-up allowlist first, since only allowlisted emails can
// create an account.
export const invite = action({
  args: { email: v.string() },
  handler: async (ctx, a): Promise<{ email: string }> => {
    await requireOwner(ctx);
    const email = sendableEmail(a.email);
    if (!email)
      throw new ConvexError({ code: "invalid_email", message: "Enter an email address." });
    if (isRoot({ email }) || (await ctx.runQuery(internal.staff.byEmailRow, { email })))
      throw new ConvexError({
        code: "already_staff",
        message: "That email is already on the list.",
      });
    const clerkAllowlistId = await allow(email);
    let clerkInvitationId: string;
    try {
      clerkInvitationId = await sendInvitation(email);
    } catch (error) {
      // No row means no way to take the allowlist entry back later.
      if (clerkAllowlistId) await quietly(unallow(clerkAllowlistId));
      throw error;
    }
    const identity = await ctx.auth.getUserIdentity();
    await ctx.runMutation(internal.staff.record, {
      email,
      invitedBy: identity?.email?.toLowerCase() ?? "",
      clerkInvitationId,
      clerkAllowlistId,
    });
    return { email };
  },
});

// A fresh invite email for someone who has not signed up yet. The old
// invitation is revoked so only the newest link works.
export const resend = action({
  args: { staffId: v.id("staff") },
  handler: async (ctx, a): Promise<{ email: string }> => {
    await requireOwner(ctx);
    const row = await ctx.runQuery(internal.staff.row, { staffId: a.staffId });
    if (!row)
      throw new ConvexError({
        code: "not_found",
        message: "That invite is no longer on the list.",
      });
    if (row.clerkUserId)
      throw new ConvexError({ code: "signed_up", message: "They've already signed up." });
    if (row.clerkInvitationId) await quietly(revoke(row.clerkInvitationId));
    const clerkInvitationId = await sendInvitation(row.email);
    await ctx.runMutation(internal.staff.setInvitation, {
      staffId: a.staffId,
      clerkInvitationId,
    });
    return { email: row.email };
  },
});

// Takes someone else off the list: cancels a waiting invite, or locks out
// someone who has signed in and deletes their Clerk account so they cannot
// sign in again. Nobody removes themselves, which would delete the account
// they are using. The row goes last but always: without it the gate refuses
// them on their next request, whatever Clerk said.
export const remove = action({
  args: { staffId: v.id("staff") },
  handler: async (ctx, a): Promise<{ email: string } | null> => {
    await requireOwner(ctx);
    const row = await ctx.runQuery(internal.staff.row, { staffId: a.staffId });
    if (!row) return null;
    if (rootRow(row))
      throw new ConvexError({ code: "root", message: "Your own account can't be removed." });
    const identity = await ctx.auth.getUserIdentity();
    const me = verifiedEmail(identity);
    if ((!!row.clerkUserId && row.clerkUserId === identity?.subject) || (!!me && row.email === me))
      throw new ConvexError({ code: "self", message: "You can't remove your own access." });
    // A Clerk account another row still names belongs to someone still listed.
    const shared =
      !!row.clerkUserId &&
      (await ctx.runQuery(internal.staff.holderCount, { clerkUserId: row.clerkUserId })) > 1;
    try {
      if (!row.clerkUserId && row.clerkInvitationId)
        await quietly(revoke(row.clerkInvitationId));
      if (row.clerkAllowlistId)
        await quietly(unallow(row.clerkAllowlistId));
      if (row.clerkUserId && !shared)
        await quietly(clerk(`/users/${row.clerkUserId}`, { method: "DELETE" }));
    } finally {
      await ctx.runMutation(internal.staff.drop, { staffId: a.staffId });
    }
    return { email: row.email };
  },
});

// The gate's question for an action, which has no database to ask directly
// (convex/auth.ts, `isOwner`).
export const isMember = internalQuery({
  args: { subject: v.string(), email: v.optional(v.string()) },
  handler: (ctx, who) => memberOf(ctx, who),
});

export const row = internalQuery({
  args: { staffId: v.id("staff") },
  handler: (ctx, a) => ctx.db.get(a.staffId),
});

export const holderCount = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, a) => (await holders(ctx, a.clerkUserId)).length,
});

export const byEmailRow = internalQuery({
  args: { email: v.string() },
  handler: (ctx, a) => byEmail(ctx, a.email),
});

// Checks for the email again: of two invites racing each other, one row.
export const record = internalMutation({
  args: {
    email: v.string(),
    invitedBy: v.string(),
    clerkInvitationId: v.string(),
    clerkAllowlistId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (await byEmail(ctx, a.email))
      throw new ConvexError({
        code: "already_staff",
        message: "That email is already on the list.",
      });
    await ctx.db.insert("staff", { ...a, invitedAt: Date.now() });
  },
});

export const setInvitation = internalMutation({
  args: { staffId: v.id("staff"), clerkInvitationId: v.string() },
  handler: async (ctx, a) => {
    if (await ctx.db.get(a.staffId))
      await ctx.db.patch(a.staffId, { clerkInvitationId: a.clerkInvitationId });
  },
});

export const drop = internalMutation({
  args: { staffId: v.id("staff") },
  handler: async (ctx, a) => {
    if (await ctx.db.get(a.staffId)) await ctx.db.delete(a.staffId);
  },
});

function byEmail(ctx: QueryCtx, email: string) {
  return ctx.db
    .query("staff")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
}

function holders(ctx: QueryCtx, clerkUserId: string) {
  return ctx.db
    .query("staff")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .collect();
}

function rootRow(row: Doc<"staff">) {
  return isRoot({ clerkUserId: row.clerkUserId, email: row.email });
}

function verifiedEmail(identity: { email?: string; emailVerified?: boolean } | null) {
  return identity?.emailVerified === true && identity.email
    ? identity.email.trim().toLowerCase()
    : undefined;
}

// Puts the email on Clerk's sign-up allowlist, and says the entry's id when
// this call made it. An entry that was already there (the deployment's own,
// from scripts/configure-clerk.mjs) comes back without one, so removing this
// person never deletes an entry they did not bring.
async function allow(email: string): Promise<string | undefined> {
  try {
    const entry = await clerk<{ id: string }>("/allowlist_identifiers", {
      method: "POST",
      body: { identifier: email, notify: false },
    });
    return entry.id;
  } catch (error) {
    const fault = clerkFault(error);
    const exists = /exist|duplicate|taken/i.test(`${fault?.clerkCode} ${fault?.message}`);
    if (fault && fault.status < 500 && exists) return undefined;
    throw error;
  }
}

// Clerk's invitation email, whose link lands on the app's sign-up page.
// `ignore_existing` lets an email that already has an account, or an open
// invitation, be invited anyway: they sign in, and `seen` finds their row.
async function sendInvitation(email: string): Promise<string> {
  const origin = appOrigin();
  const invitation = await clerk<{ id: string }>("/invitations", {
    method: "POST",
    body: {
      email_address: email,
      ...(origin ? { redirect_url: `${origin}/sign-up` } : {}),
      notify: true,
      ignore_existing: true,
    },
  });
  return invitation.id;
}

function unallow(allowlistId: string) {
  return clerk(`/allowlist_identifiers/${allowlistId}`, { method: "DELETE" });
}

function revoke(invitationId: string) {
  return clerk(`/invitations/${invitationId}/revoke`, { method: "POST" });
}

// Clerk tidying that must not stop what was asked for. A 404 is already done;
// anything else is logged for whoever looks after the deployment.
async function quietly(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (clerkFault(error)?.status !== 404) console.error("Clerk call failed:", error);
  }
}
