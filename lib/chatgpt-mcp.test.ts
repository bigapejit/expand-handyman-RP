import { getFunctionName, type FunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";

import type { ConvexCaller } from "./chatgpt-connector";
import { connectorMcpHandler } from "./chatgpt-mcp";
import { DefaultJobMathSettings } from "./job-math";

// The connector's MCP server spoken to over its real protocol, as ChatGPT
// does, with the sign-in already done (the route's gates are not part of this
// handler) and a fake Convex answering behind the tools.
function server(handlers: Record<string, () => unknown>) {
  const call = async (ref: FunctionReference<"query" | "mutation" | "action">) => {
    const handler = handlers[getFunctionName(ref)];
    if (!handler) throw new Error(`No fake for ${getFunctionName(ref)}`);
    return handler();
  };
  const convex = { query: call, mutation: call, action: call } as unknown as ConvexCaller;
  const seen: unknown[] = [];
  const handle = connectorMcpHandler((authInfo) => {
    seen.push(authInfo);
    return { convex, origin: "https://staff.expandhandyman.com" };
  });

  let id = 0;
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const request = new Request("https://staff.expandhandyman.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    request.auth = { token: "oauth-token", clientId: "chatgpt", scopes: [], extra: { userId: "user_1" } };
    const response = await handle(request);
    const text = await response.text();
    // A streamable HTTP answer may come as JSON or as one server-sent event.
    const body = response.headers.get("content-type")?.includes("text/event-stream")
      ? text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5))
          .join("")
      : text;
    return { status: response.status, message: JSON.parse(body) };
  }
  return { rpc, seen };
}

const initialize = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "chatgpt-test", version: "1" },
};

describe("the connector's MCP server", () => {
  test("introduces itself with instructions about dollars and drafts", async () => {
    const { rpc } = server({});
    const { status, message } = await rpc("initialize", initialize);
    expect(status).toBe(200);
    expect(message.result.serverInfo.name).toBe("expand-handyman-staff");
    expect(message.result.instructions).toMatch(/US dollars/);
    expect(message.result.instructions).toMatch(/stay drafts/);
  });

  test("lists every tool with its input schema and the three hints", async () => {
    const { rpc } = server({});
    await rpc("initialize", initialize);
    const { message } = await rpc("tools/list");
    const tools = message.result.tools as {
      name: string;
      inputSchema: { type: string; properties: Record<string, unknown> };
      annotations: Record<string, unknown>;
    }[];
    expect(tools.map((t) => t.name)).toEqual([
      "find_customers",
      "get_site",
      "list_proposals",
      "get_proposal",
      "job_math",
      "create_customer",
      "create_site",
      "create_solution",
      "update_solution",
      "create_proposal",
      "add_solutions_to_proposal",
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations).toEqual(
        expect.objectContaining({
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
        }),
      );
    }
    const solution = tools.find((t) => t.name === "create_solution")!;
    expect(Object.keys(solution.inputSchema.properties)).toEqual(
      expect.arrayContaining(["site_id", "title", "line_items", "markup_percent"]),
    );
  });

  test("runs a tool with the request's sign-in and answers in dollars", async () => {
    const { rpc, seen } = server({
      "settings:get": () => ({ zelleTag: "expandhandyman", jobMath: DefaultJobMathSettings }),
    });
    await rpc("initialize", initialize);
    const { message } = await rpc("tools/call", {
      name: "job_math",
      arguments: { price_dollars: 1000, hours: 10, other_costs_dollars: 100 },
    });
    expect(message.result.isError).toBeFalsy();
    expect(message.result.structuredContent).toMatchObject({
      left_for_labor_dollars: 600,
      you_do_it: { take_home_dollars: 450 },
    });
    expect(JSON.parse(message.result.content[0].text)).toEqual(message.result.structuredContent);
    expect(seen.at(-1)).toMatchObject({ token: "oauth-token", extra: { userId: "user_1" } });
  });

  test("hands back a refusal as a tool error ChatGPT can read", async () => {
    const { rpc } = server({ "sites:get": () => null });
    await rpc("initialize", initialize);
    const { message } = await rpc("tools/call", {
      name: "create_solution",
      arguments: { site_id: "nope", title: "Gutters" },
    });
    expect(message.result.isError).toBe(true);
    expect(message.result.content[0].text).toMatch(/No site has the id nope/);
  });
});
