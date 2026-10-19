// RFC 9728 Protected Resource Metadata for the ChatGPT connector's /mcp
// endpoint: where a client that has only that address learns that Clerk is
// the authorization server to sign in with. The 401 from /mcp points here.

import { getPublicOrigin } from "mcp-handler";

import {
  clerkAuthServerUrl,
  MetadataCorsHeaders,
  protectedResourceMetadata,
} from "@/lib/mcp-auth";

export function GET(req: Request) {
  const metadata = protectedResourceMetadata(
    getPublicOrigin(req),
    clerkAuthServerUrl(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
  );
  return Response.json(metadata, {
    headers: { ...MetadataCorsHeaders, "Cache-Control": "max-age=3600" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MetadataCorsHeaders });
}
