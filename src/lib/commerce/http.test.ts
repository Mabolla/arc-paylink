import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { CommerceService } from "./service";
import { MemoryStore } from "./test-store";
import { credential } from "./http";

const context = vi.hoisted(() => ({
  service: undefined as CommerceService | undefined,
}));
vi.mock("./http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./http")>()),
  commerce: () => context.service!,
}));
import { GET, POST } from "../../app/api/business/[[...path]]/route";
import { POST as mcpPost } from "../../app/api/business/mcp/route";
const recipient = "0x1111111111111111111111111111111111111111";
const route = (path: string[]) => ({ params: Promise.resolve({ path }) });
function request(path: string, body?: unknown, token?: string) {
  return new Request(`https://example.com/api/business/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  context.service = new CommerceService(new MemoryStore());
});

describe("business HTTP and remote agent boundaries", () => {
  it("creates an HttpOnly session, authenticates it and rejects cross-origin mutation", async () => {
    const res = await POST(
      request("workspaces", { name: "Test", recipient }),
      route(["workspaces"]),
    );
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    const session = await GET(
      new Request("https://example.com/api/business/session", {
        headers: { cookie },
      }),
      route(["session"]),
    );
    expect(session.status).toBe(200);
    const bad = request("orders", {
      reference: "INV",
      title: "Order",
      amount: "5",
      idempotencyKey: randomUUID(),
    });
    bad.headers.set("origin", "https://evil.example");
    bad.headers.set("cookie", cookie);
    expect((await POST(bad, route(["orders"]))).status).not.toBe(201);
    expect((await GET(request("orders"), route(["orders"]))).status).toBe(401);
  });
  it("requires explicit Bearer auth for remote MCP even with an owner cookie", async () => {
    const r = new Request("https://example.com/api/business/mcp", {
      method: "POST",
      headers: { cookie: "arcpaylink_business=something" },
      body: "{}",
    });
    expect((await mcpPost(r)).status).toBe(401);
    expect(
      credential(
        new Request("https://example.com", {
          headers: {
            authorization: "Basic invalid",
            cookie: "arcpaylink_business=valid",
          },
        }),
      ),
    ).toBeUndefined();
  });
  it("completes stateless MCP initialize/list/call over actual web Request and Response", async () => {
    const created = await context.service!.createWorkspace({
      name: "MCP HTTP",
      recipient,
    });
    const p = await context.service!.authorize(created.token);
    const agent = await context.service!.issueReader(p, "Reader");
    await context.service!.createOrder(p, {
      reference: "HTTP-001",
      title: "Contract delivery",
      amount: "2.50",
      idempotencyKey: randomUUID(),
    });
    async function rpc(method: string, params: unknown, id: number) {
      const req = request(
        "mcp",
        { jsonrpc: "2.0", id, method, params },
        agent.token,
      );
      req.headers.set("accept", "application/json, text/event-stream");
      req.headers.set("mcp-protocol-version", "2025-03-26");
      const response = await mcpPost(req);
      expect(response.status).toBe(200);
      return response.json();
    }
    expect(
      (
        await rpc(
          "initialize",
          {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "QA", version: "1" },
          },
          1,
        )
      ).result.serverInfo.name,
    ).toBe("arcpaylink-collections");
    const tools = (await rpc("tools/list", {}, 2)).result.tools;
    expect(tools).toHaveLength(5);
    expect(tools.find((tool: { name: string }) => tool.name === "get_collections_monitor"))
      .toMatchObject({ annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } });
    const report = await rpc(
      "tools/call",
      { name: "get_receivables_summary", arguments: {} },
      3,
    );
    expect(JSON.parse(report.result.content[0].text).outstandingUsdc).toBe(
      "2.5",
    );
    const monitor = await rpc(
      "tools/call",
      { name: "get_collections_monitor", arguments: {} },
      4,
    );
    expect(monitor.result.isError).not.toBe(true);
    expect(JSON.parse(monitor.result.content[0].text)).toEqual({ monitor: null });
    await context.service!.revokeKey(p, agent.key.id);
    const revoked = request(
      "mcp",
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
      agent.token,
    );
    expect((await mcpPost(revoked)).status).toBe(401);
  });
});
