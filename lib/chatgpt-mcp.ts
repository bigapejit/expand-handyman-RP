// The **ChatGPT connector**'s MCP server: every tool in
// lib/chatgpt-connector.ts registered on an mcp-handler request handler. Kept
// apart from app/mcp/route.ts, which adds the sign-in and staff gates, so a
// test can speak the real protocol to it with a fake Convex behind it
// (lib/chatgpt-mcp.test.ts) without any way in being added to the route.
//
// mcp-handler 2 with @modelcontextprotocol/server 2 and the zod 4 the app
// already uses, which install and typecheck together. Clerk's
// @clerk/mcp-tools was left out: it pulls in the 1.x MCP SDK, whose AuthInfo
// type clashes with the 2.x one, and the helpers it would give are a few
// lines each in lib/mcp-auth.ts.

import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "mcp-handler";

import {
  callTool,
  ConnectorInstructions,
  ConnectorTools,
  type ToolContext,
} from "./chatgpt-connector";

// `contextFor` turns the request's verified AuthInfo into what a tool calls
// Convex with. The route builds it from the staff member's minted token.
export function connectorMcpHandler(
  contextFor: (authInfo: AuthInfo | undefined) => ToolContext,
): (request: Request) => Promise<Response> {
  return createMcpHandler(
    (server) => {
      for (const tool of ConnectorTools) {
        server.registerTool(
          tool.name,
          {
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { title: tool.title, ...tool.annotations },
          },
          async (args, ctx) => {
            const result = await callTool(tool, args, contextFor(ctx.http?.authInfo));
            // A refusal is a tool result ChatGPT reads and can act on, not a
            // protocol error: it says what to fix, in the app's own words.
            return result.ok
              ? {
                  content: [{ type: "text", text: JSON.stringify(result.output) }],
                  structuredContent: result.output,
                }
              : { isError: true, content: [{ type: "text", text: result.message }] };
          },
        );
      }
    },
    {
      serverInfo: { name: "expand-handyman-staff", version: "1.0.0" },
      instructions: ConnectorInstructions,
    },
  );
}
