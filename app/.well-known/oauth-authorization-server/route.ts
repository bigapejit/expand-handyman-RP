// RFC 8414 Authorization Server Metadata, passed through from Clerk. The
// protected resource metadata already names Clerk as the authorization
// server, and current clients read this from Clerk itself; this copy is for
// older MCP clients that look for it on the MCP server's own host, as Clerk's
// MCP guide serves it. Whether dynamic registration (`registration_endpoint`)
// or client ID metadata documents are offered is set in Clerk's dashboard.

import { clerkAuthServerUrl, MetadataCorsHeaders } from "@/lib/mcp-auth";

export async function GET() {
  const issuer = clerkAuthServerUrl(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const response = await fetch(`${issuer}/.well-known/oauth-authorization-server`, {
    next: { revalidate: 3600 },
  });
  if (!response.ok)
    return Response.json(
      { error: "temporarily_unavailable", error_description: "Clerk did not answer. Try again." },
      { status: 502, headers: MetadataCorsHeaders },
    );
  return Response.json(await response.json(), {
    headers: { ...MetadataCorsHeaders, "Cache-Control": "max-age=3600" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MetadataCorsHeaders });
}
