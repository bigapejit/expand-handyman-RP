import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
};
http.route({
  path: "/file",
  method: "OPTIONS",
  handler: httpAction(
    async (_ctx, req) =>
      new Response(null, { status: 204, headers: cors(req) }),
  ),
});
http.route({
  path: "/file",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    try {
      const url = new URL(req.url);
      const access = await ctx.runQuery(internal.documents.fileAccess, {
        id: url.searchParams.get("id") as Id<"documents">,
        token: url.searchParams.get("token") || undefined,
        signed: url.searchParams.get("signed") === "1",
      });
      if (!access?.storageId)
        return new Response("Document unavailable", {
          status: 404,
          headers: cors(req),
        });
      const blob = await ctx.storage.get(access.storageId);
      if (!blob)
        return new Response("Document unavailable", {
          status: 404,
          headers: cors(req),
        });
      return new Response(blob, {
        headers: {
          ...cors(req),
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="document.pdf"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Document unavailable", {
        status: 404,
        headers: cors(req),
      });
    }
  }),
});
export default http;
