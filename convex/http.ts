import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  disputedChargeFromStripe,
  failureReasonFromStripe,
  verifiedStripeEvent,
} from "./stripePayments";
import { prunedStripeEvent, readStripeEvent } from "../lib/stripe-events";
import { eventTypeOf, webhookAuthorized } from "../lib/thumbtack";
const http = httpRouter();
const cors = (request: Request) => {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = [
    "http://localhost:3210",
    "https://staff.expandhandyman.com",
    "https://expand-handyman-rp.vercel.app",
  ];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : "https://staff.expandhandyman.com",
    Vary: "Origin",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
};
http.route({
  path: "/seen",
  method: "OPTIONS",
  handler: httpAction(
    async (_ctx, req) =>
      new Response(null, { status: 204, headers: cors(req) }),
  ),
});
http.route({
  path: "/seen",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = JSON.parse(await req.text());
      if (typeof body?.viewId === "string" && typeof body?.token === "string")
        await ctx.runMutation(internal.signingLinks.recordSeen, {
          viewId: body.viewId as Id<"proposalViews">,
          token: body.token,
        });
    } catch {
      // A beacon has no one to report to; an unreadable body is simply dropped.
    }
    return new Response(null, { status: 204, headers: cors(req) });
  }),
});
// Thumbtack's webhook: new leads and chat messages, server to server, so no
// CORS. Every delivery is logged, taken or refused, except while no secret is
// set, when the endpoint is simply shut. It never throws: Thumbtack's retries
// are undocumented, so a failure is answered and logged rather than left to
// the runtime.
const thumbtackReply = (status: number, body?: Record<string, unknown>) =>
  new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: body ? { "Content-Type": "application/json" } : {},
  });
// Enough of a refused body to see what it was.
const MaxLoggedBody = 100_000;
http.route({
  path: "/thumbtack",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.THUMBTACK_WEBHOOK_SECRET;
    if (!secret) return thumbtackReply(401);
    let raw: string | undefined;
    let eventType = "";
    try {
      // Nothing is written for a wrong secret: the endpoint is on the open
      // internet, and a scanner must not be able to fill the event log.
      if (!webhookAuthorized(req.headers, secret)) return thumbtackReply(401);
      raw = await req.text();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        await ctx.runMutation(internal.leads.logRejected, {
          eventType,
          body: raw.slice(0, MaxLoggedBody),
          note: "The body is not JSON.",
        });
        return thumbtackReply(400);
      }
      eventType = eventTypeOf(body);
      await ctx.runMutation(internal.leads.receive, { body });
      return thumbtackReply(200, { ok: true });
    } catch (error) {
      // The raw text, not the parsed body: the body may be what failed, as a
      // key Convex cannot store would.
      try {
        await ctx.runMutation(internal.leads.logRejected, {
          eventType,
          body: raw?.slice(0, MaxLoggedBody) ?? null,
          note: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Nowhere left to record it; the 500 is all Thumbtack gets.
      }
      return thumbtackReply(500);
    }
  }),
});
// Stripe's webhook, for **Pay now** (CONTEXT.md): the two destinations, test
// on dev and live on production, deliver here, server to server. The body is
// read as text, untouched, because the signature is over the raw bytes. A
// delivery that is not Stripe's (a bad signature, a body that is not an
// event) is answered 400 and logged, never stored, so a scanner cannot fill
// a table; while no signing secret is set the endpoint is shut, as the
// Thumbtack one is. Anything else is applied by one mutation and answered
// 200, including the event types the app leaves alone, so Stripe stops
// sending them; only a failure to apply answers 500, for Stripe to retry.
// What the mutation needs and the event does not carry, a returned payment's
// reason or a lost dispute's charge, is asked of Stripe first.
const stripeReply = (status: number) => new Response(null, { status });
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      console.error("Stripe webhook refused: this deployment has no STRIPE_WEBHOOK_SECRET.");
      return stripeReply(401);
    }
    let event;
    try {
      event = prunedStripeEvent(
        await verifiedStripeEvent(
          await req.text(),
          req.headers.get("Stripe-Signature") ?? "",
          secret,
        ),
      );
    } catch (error) {
      console.error(
        `Stripe webhook refused: ${error instanceof Error ? error.message : String(error)}`,
      );
      return stripeReply(400);
    }
    try {
      const reading = readStripeEvent(event);
      const failureReason = await failureReasonFromStripe(reading);
      const charge = await disputedChargeFromStripe(reading);
      await ctx.runMutation(internal.stripePayments.applyStripeEvent, {
        event,
        ...(failureReason ? { failureReason } : {}),
        ...(charge ? { charge } : {}),
      });
      return stripeReply(200);
    } catch (error) {
      console.error(
        `Stripe event ${String(event.id)} was not applied: ${error instanceof Error ? error.message : String(error)}`,
      );
      return stripeReply(500);
    }
  }),
});
export default http;
