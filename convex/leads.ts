import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwner } from "./auth";
import { leadStage } from "./schema";
import { normalizePhone } from "../lib/customer";
import {
  OPEN_STAGES,
  PLACEHOLDER_CATEGORY,
  UNNAMED_CUSTOMER,
  eventKind,
  eventTypeOf,
  isUnread,
  nextStageOnBusinessReply,
  parseLeadEvent,
  parseMessageEvent,
  stageOnProposalApproved,
  stageOnProposalSent,
  type ParsedLead,
  type ParsedMessage,
} from "../lib/thumbtack";

type Outcome = Doc<"thumbtackEvents">["outcome"];

// One Thumbtack webhook delivery, already authorized by convex/http.ts. The
// event is logged whatever becomes of it, in the same transaction as what it
// wrote, so the log never claims a lead that is not there.
export const receive = internalMutation({
  args: { body: v.any() },
  handler: async (ctx, { body }) => {
    const kind = eventKind(body);
    const { outcome, note } =
      kind === "lead"
        ? await receiveLead(ctx, body)
        : kind === "message"
          ? await receiveMessage(ctx, body)
          : { outcome: "ignored" as const, note: undefined };
    await ctx.db.insert("thumbtackEvents", {
      eventType: eventTypeOf(body),
      receivedAt: Date.now(),
      outcome,
      body,
      ...(note ? { note } : {}),
    });
    return outcome;
  },
});

// A delivery refused before `receive` could read it: a wrong secret, a body
// that is not JSON, or an error. The body is whatever could be kept of it.
export const logRejected = internalMutation({
  args: { eventType: v.string(), body: v.any(), note: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert("thumbtackEvents", {
      eventType: a.eventType,
      receivedAt: Date.now(),
      outcome: "rejected",
      body: a.body,
      note: a.note,
    });
  },
});

type Received = { outcome: Outcome; note?: string };

async function receiveLead(ctx: MutationCtx, body: unknown): Promise<Received> {
  const parsed = parseLeadEvent(body);
  if ("fault" in parsed) return { outcome: "rejected", note: parsed.fault };
  const { customerName, phone, ...fields } = parsed;

  const existing = await leadByNegotiation(ctx, fields.negotiationId);
  if (existing && existing.category !== PLACEHOLDER_CATEGORY)
    return { outcome: "duplicate" };
  if (existing) {
    // A message got here first and made a stand-in; the lead's own details
    // replace it, and the stage, chat and Unread it has gathered stay.
    await ctx.db.patch(existing._id, fields);
    await fillPlaceholderCustomer(ctx, existing.customerId, parsed);
    return { outcome: "lead", note: "Filled in a placeholder made by an earlier message." };
  }

  const customerId =
    (await customerOfThumbtackCustomer(ctx, fields.thumbtackCustomerId)) ??
    (await customerWithPhone(ctx, phone)) ??
    (await ctx.db.insert("customers", {
      name: customerName,
      email: "",
      // Not through parseCustomer: a number its validator would refuse is
      // still the only way to reach this customer, so it is kept as sent.
      phone: normalizePhone(phone) ?? phone,
      ...(phone ? { phoneFrom: "thumbtack" as const } : {}),
    }));
  const now = Date.now();
  await ctx.db.insert("leads", {
    ...fields,
    customerId,
    stage: "new",
    stageChangedAt: now,
  });
  return { outcome: "lead" };
}

async function receiveMessage(ctx: MutationCtx, body: unknown): Promise<Received> {
  const parsed = parseMessageEvent(body);
  if ("fault" in parsed) return { outcome: "rejected", note: parsed.fault };
  const seen = await ctx.db
    .query("leadMessages")
    .withIndex("by_message", (q) => q.eq("messageId", parsed.messageId))
    .first();
  if (seen) return { outcome: "duplicate" };

  let note: string | undefined;
  let lead = await leadByNegotiation(ctx, parsed.negotiationId);
  if (!lead) {
    lead = await placeholderLead(ctx, parsed);
    note = "No lead for this negotiationID; made a placeholder.";
  }

  await ctx.db.insert("leadMessages", {
    leadId: lead._id,
    messageId: parsed.messageId,
    from: parsed.from,
    text: parsed.text,
    attachments: parsed.attachments,
    sentAt: parsed.sentAt,
  });
  // Deliveries may come out of order; the latest send wins.
  const latest = (held: number | undefined) => Math.max(held ?? 0, parsed.sentAt);
  const stage = parsed.from === "business" ? nextStageOnBusinessReply(lead.stage) : lead.stage;
  await ctx.db.patch(lead._id, {
    lastMessageAt: latest(lead.lastMessageAt),
    ...(parsed.from === "customer"
      ? { lastCustomerMessageAt: latest(lead.lastCustomerMessageAt) }
      : {}),
    ...(stage === lead.stage ? {} : { stage, stageChangedAt: Date.now() }),
  });
  return { outcome: "message", ...(note ? { note } : {}) };
}

// A message for a lead the app never saw, as for a lead from before the
// webhook was switched on. It still needs a lead to sit under, so one is made
// with what the message says, and the lead's own webhook fills it in if it
// ever comes.
async function placeholderLead(ctx: MutationCtx, message: ParsedMessage) {
  const thumbtackCustomerId = message.thumbtackCustomerId ?? "";
  const customerId =
    (thumbtackCustomerId &&
      (await customerOfThumbtackCustomer(ctx, thumbtackCustomerId))) ||
    (await ctx.db.insert("customers", {
      name: message.customerDisplayName ?? UNNAMED_CUSTOMER,
      email: "",
      phone: "",
    }));
  const now = Date.now();
  const leadId = await ctx.db.insert("leads", {
    customerId,
    negotiationId: message.negotiationId,
    thumbtackCustomerId,
    arrivedAt: message.sentAt,
    category: PLACEHOLDER_CATEGORY,
    description: "",
    details: [],
    location: { city: "", state: "", zipCode: "" },
    attachments: [],
    stage: "new",
    stageChangedAt: now,
  });
  const lead = await ctx.db.get(leadId);
  if (!lead) throw new Error("The placeholder lead did not save.");
  return lead;
}

// The placeholder's customer takes the lead's name and number, but only while
// it is still the bare stand-in: a customer the owner has since edited, or one
// matched to a real lead, is left alone.
async function fillPlaceholderCustomer(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  lead: ParsedLead,
) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.email || customer.phone) return;
  await ctx.db.patch(customerId, {
    name: lead.customerName,
    phone: normalizePhone(lead.phone) ?? lead.phone,
    ...(lead.phone ? { phoneFrom: "thumbtack" as const } : {}),
  });
}

function leadByNegotiation(ctx: QueryCtx, negotiationId: string) {
  return ctx.db
    .query("leads")
    .withIndex("by_negotiation", (q) => q.eq("negotiationId", negotiationId))
    .first();
}

// Thumbtack's customer ID is the surest match: the same person on a second
// request.
async function customerOfThumbtackCustomer(ctx: QueryCtx, thumbtackCustomerId: string) {
  const lead = await ctx.db
    .query("leads")
    .withIndex("by_thumbtack_customer", (q) => q.eq("thumbtackCustomerId", thumbtackCustomerId))
    .first();
  return lead?.customerId ?? null;
}

// A customer the owner added by hand before the lead came, found by number.
// A scan, as the Customers list is: there are hundreds, not millions.
async function customerWithPhone(ctx: QueryCtx, phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  for (const customer of await ctx.db.query("customers").take(1000))
    if (normalizePhone(customer.phone) === normalized) return customer._id;
  return null;
}

async function lastMessage(ctx: QueryCtx, leadId: Id<"leads">) {
  const message = await ctx.db
    .query("leadMessages")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .order("desc")
    .first();
  return message ? { text: message.text, from: message.from, sentAt: message.sentAt } : null;
}

// The **Thumbtack board**: every lead, newest first, with who it is from, the
// last word in its chat and whether it is Unread. The page splits open from
// Closed.
export const board = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const leads = await ctx.db.query("leads").take(1000);
    const rows = await Promise.all(
      leads.map(async (lead) => {
        const customer = await ctx.db.get(lead.customerId);
        return {
          ...lead,
          customerName: customer?.name ?? "",
          phone: customer?.phone ?? "",
          phoneFrom: customer?.phoneFrom,
          lastMessage: await lastMessage(ctx, lead._id),
          unread: isUnread(lead),
        };
      }),
    );
    return rows.sort((a, b) => b.arrivedAt - a.arrivedAt);
  },
});

// A customer's leads, newest first, each with its whole **Thumbtack chat**.
export const forCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, { customerId }) => {
    await requireOwner(ctx);
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .collect();
    const rows = await Promise.all(
      leads.map(async (lead) => ({
        ...lead,
        unread: isUnread(lead),
        messages: await ctx.db
          .query("leadMessages")
          .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
          .order("asc")
          .collect(),
      })),
    );
    return rows.sort((a, b) => b.arrivedAt - a.arrivedAt);
  },
});

// One lead's **Thumbtack chat**, oldest first, for the board's panel: `board`
// carries only the last message. Null when there is no such lead.
export const thread = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    await requireOwner(ctx);
    if (!(await ctx.db.get(leadId))) return null;
    return await ctx.db
      .query("leadMessages")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .order("asc")
      .collect();
  },
});

// Opening a lead clears **Unread**; nothing on Thumbtack does.
export const open = mutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    await requireOwner(ctx);
    if (!(await ctx.db.get(leadId))) throw new Error("Lead not found.");
    await ctx.db.patch(leadId, { openedAt: Date.now() });
  },
});

// The owner moving a lead by hand, to any stage: only the app's own moves are
// forward-only.
export const setStage = mutation({
  args: { leadId: v.id("leads"), stage: leadStage },
  handler: async (ctx, { leadId, stage }) => {
    await requireOwner(ctx);
    const lead = await ctx.db.get(leadId);
    if (!lead) throw new Error("Lead not found.");
    if (lead.stage === stage) return;
    await ctx.db.patch(leadId, { stage, stageChangedAt: Date.now() });
  },
});

// The nav badge: open leads the owner has not opened since the customer wrote.
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    let count = 0;
    for (const stage of OPEN_STAGES) {
      const leads = await ctx.db
        .query("leads")
        .withIndex("by_stage", (q) => q.eq("stage", stage))
        .take(1000);
      count += leads.filter(isUnread).length;
    }
    return count;
  },
});

// The app moving a customer's leads when a proposal to them is sent or
// approved (CONTEXT.md, **Stage**). Every lead of the customer moves: a
// proposal is for a site, and nothing ties it to one of their leads.
export async function advanceForCustomer(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  event: "sent" | "approved",
) {
  const move = event === "sent" ? stageOnProposalSent : stageOnProposalApproved;
  const leads = await ctx.db
    .query("leads")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  const now = Date.now();
  for (const lead of leads) {
    const stage = move(lead.stage);
    if (stage !== lead.stage) await ctx.db.patch(lead._id, { stage, stageChangedAt: now });
  }
}
