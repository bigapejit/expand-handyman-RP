import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwner } from "./auth";
import { dealForLead, moveDeal } from "./deals";
import { normalizePhone } from "../lib/customer";
import { OPEN_STAGES, stageOnCustomerReply } from "../lib/pipeline";
import {
  PLACEHOLDER_CATEGORY,
  UNNAMED_CUSTOMER,
  eventKind,
  eventTypeOf,
  isUnread,
  parseLeadEvent,
  parseMessageEvent,
  type ParsedLead,
  type ParsedMessage,
} from "../lib/thumbtack";

type Outcome = Doc<"thumbtackEvents">["outcome"];

// One Thumbtack webhook delivery, already authorized by convex/http.ts. The
// event is logged whatever becomes of it, in the same transaction as what it
// wrote, so the log never claims a lead that is not there. Every lead is a
// **Deal** from the moment it lands (convex/deals.ts), and the deal holds its
// stage.
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
    // replace it, and the deal's stage, the chat and Unread it has gathered
    // stay. The customer is matched as a fresh lead's would be, so a
    // returning customer whose reply beat the lead webhook still ends up with
    // one record.
    await ctx.db.patch(existing._id, { ...fields, phone });
    const deal = await dealForLead(ctx, existing);
    // The stand-in's job was only "Thumbtack message", begun at the first
    // message; the lead says what and when.
    if (deal.title === PLACEHOLDER_CATEGORY)
      await ctx.db.patch(deal._id, {
        title: fields.category,
        createdAt: fields.arrivedAt,
        updatedAt: Date.now(),
      });
    const matched =
      (await customerOfThumbtackCustomer(ctx, fields.thumbtackCustomerId, existing._id)) ??
      (await customerWithPhone(ctx, phone));
    if (matched && matched !== existing.customerId) {
      await ctx.db.patch(existing._id, { customerId: matched });
      // A site the owner had put on the stand-in's deal is the stand-in's,
      // and a deal's site must be its own customer's, so the deal leaves it,
      // and with it any proposal sent from there. A stage a proposal had
      // moved it to, Sent out or Won, was the stand-in's too, whether the
      // deal still reads that proposal or let go of it on a site change: the
      // deal goes back to where the chat so far puts it, New or Talking.
      const byProposal =
        deal.proposalId !== undefined || deal.stage === "quoted" || deal.stage === "won";
      const stage = !byProposal
        ? deal.stage
        : existing.lastCustomerMessageAt === undefined
          ? "new"
          : stageOnCustomerReply("new", existing.lastBusinessMessageAt !== undefined);
      const now = Date.now();
      await ctx.db.patch(deal._id, {
        customerId: matched,
        siteId: undefined,
        proposalId: undefined,
        stage,
        ...(stage === deal.stage ? {} : { stageChangedAt: now }),
        updatedAt: now,
      });
      await dropBareStandIn(ctx, existing.customerId);
    } else await fillPlaceholderCustomer(ctx, existing.customerId, parsed);
    return { outcome: "lead", note: "Filled in a placeholder made by an earlier message." };
  }

  const customerId =
    (await customerOfThumbtackCustomer(ctx, fields.thumbtackCustomerId)) ??
    (await customerWithPhone(ctx, phone)) ??
    (await ctx.db.insert("customers", {
      name: customerName,
      email: "",
      // Only a number the customer dialog could save again; anything else
      // stays on the lead, as sent, so the owner can still read it.
      ...thumbtackPhone(phone),
    }));
  const leadId = await ctx.db.insert("leads", { ...fields, phone, customerId });
  const lead = await ctx.db.get(leadId);
  if (!lead) throw new Error("The lead did not save.");
  await dealForLead(ctx, lead);
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
  await ctx.db.patch(lead._id, {
    lastMessageAt: latest(lead.lastMessageAt),
    ...(parsed.from === "customer"
      ? { lastCustomerMessageAt: latest(lead.lastCustomerMessageAt) }
      : { lastBusinessMessageAt: latest(lead.lastBusinessMessageAt) }),
  });
  // Only the customer answering moves the lead's deal: to Talking, once the
  // owner has written too. The owner's own message alone moves nothing.
  if (parsed.from === "customer") {
    const deal = await dealForLead(ctx, lead);
    await moveDeal(
      ctx,
      deal,
      stageOnCustomerReply(deal.stage, lead.lastBusinessMessageAt !== undefined),
    );
  }
  return { outcome: "message", ...(note ? { note } : {}) };
}

// A message for a lead the app never saw, as for a lead from before the
// webhook was switched on. It still needs a lead to sit under, so one is made
// with what the message says, with its deal, and the lead's own webhook fills
// both in if it ever comes.
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
  });
  const lead = await ctx.db.get(leadId);
  if (!lead) throw new Error("The placeholder lead did not save.");
  const deal = await dealForLead(ctx, lead);
  return { ...lead, dealId: deal._id };
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
  await ctx.db.patch(customerId, { name: lead.customerName, ...thumbtackPhone(lead.phone) });
}

// The customer's side of a lead's phone: normalized and marked as the
// **Thumbtack number**, or blank when the validator would refuse it, so the
// owner can still save the customer's name or email later.
function thumbtackPhone(raw: string) {
  const phone = normalizePhone(raw);
  return phone ? { phone, phoneFrom: "thumbtack" as const } : { phone: "" };
}

// A placeholder's blank customer, once its lead has been matched to a real
// one. Deleted only while it is still bare and nothing else hangs off it.
async function dropBareStandIn(ctx: MutationCtx, customerId: Id<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.email || customer.phone) return;
  for (const table of ["leads", "deals", "sites"] as const) {
    const held = await ctx.db
      .query(table)
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .first();
    if (held) return;
  }
  await ctx.db.delete(customerId);
}

function leadByNegotiation(ctx: QueryCtx, negotiationId: string) {
  return ctx.db
    .query("leads")
    .withIndex("by_negotiation", (q) => q.eq("negotiationId", negotiationId))
    .first();
}

// Thumbtack's customer ID is the surest match: the same person on a second
// request.
// A placeholder made from a business message has no Thumbtack customer id, so
// an empty id matches nobody; `except` is the lead being filled in, whose own
// stand-in customer is not a match.
async function customerOfThumbtackCustomer(
  ctx: QueryCtx,
  thumbtackCustomerId: string,
  except?: Id<"leads">,
) {
  if (!thumbtackCustomerId) return null;
  const held = await ctx.db
    .query("leads")
    .withIndex("by_thumbtack_customer", (q) => q.eq("thumbtackCustomerId", thumbtackCustomerId))
    .take(50);
  return held.find((lead) => lead._id !== except)?.customerId ?? null;
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

// A lead's stage, which its deal holds. A lead from before deals that
// `migrations:dealsFromLeads` has not reached yet still reads the stage it
// carried itself, so the window between deploy and migration shows no change.
async function stageOfLead(ctx: QueryCtx, lead: Doc<"leads">) {
  const deal = lead.dealId ? await ctx.db.get(lead.dealId) : null;
  return deal?.stage ?? lead.stage ?? "new";
}

// A customer's leads, newest first, each with its whole **Thumbtack chat**
// and its deal's stage.
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
        stage: await stageOfLead(ctx, lead),
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

// The nav badge: Unread leads whose deal is still open. Read from the open
// deals, the board's own working set, so the count matches the board however
// many leads there have ever been. (A lead from before deals counts once the
// Pipeline page has given it one, on its first open after the deploy.)
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const open = (
      await Promise.all(
        OPEN_STAGES.map((stage) =>
          ctx.db.query("deals").withIndex("by_stage", (q) => q.eq("stage", stage)).collect(),
        ),
      )
    ).flat();
    let count = 0;
    for (const deal of open) {
      const lead = deal.leadId ? await ctx.db.get(deal.leadId) : null;
      if (lead && isUnread(lead)) count++;
    }
    return count;
  },
});
