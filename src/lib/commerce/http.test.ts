import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { CommerceService, orderPath } from "./service";
import type { Order } from "./types";
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
  it("lets only the owning company clear a customer reference while preserving paid evidence and retry identity", async () => {
    const service = context.service!;
    const owner = await service.createWorkspace({ name: "Privacy owner", recipient });
    const principal = await service.authorize(owner.token);
    const reader = await service.issueReader(principal, "Privacy reader");
    const foreign = await service.createWorkspace({ name: "Foreign company", recipient });
    const input = { reference: "PRIVACY-1", title: "Delivery", customerReference: "CUSTOMER-042", amount: "0.01", idempotencyKey: randomUUID() };
    const order = await service.createOrder(principal, input);
    const path = orderPath(principal.workspace.id, order.id);
    const saved = (await service.store.read<Order>(path))!;
    const paid: Order = { ...saved.value, status: "paid", receipt: { transactionHash: `0x${"1".repeat(64)}`, sender: recipient, blockNumber: "42", confirmedAt: new Date().toISOString() } };
    await service.store.write(path, paid, saved.version);
    const endpoint = `orders/${order.id}/clear-customer-reference`;
    const params = route(endpoint.split("/"));
    expect((await POST(request(endpoint, {}, reader.token), params)).status).toBe(403);
    expect((await POST(request(endpoint, {}, foreign.token), params)).status).toBe(404);
    expect((await service.order(principal, order.id)).customerReference).toBe("CUSTOMER-042");
    expect((await POST(request(endpoint, {}, owner.token), params)).status).toBe(200);
    expect(await service.order(principal, order.id)).toEqual({ ...paid, customerReference: "" });
    expect((await POST(request(endpoint, {}, owner.token), params)).status).toBe(200);
    expect((await service.createOrder(principal, input)).customerReference).toBe("");
    const readback = await GET(request(`orders/${order.id}`, undefined, reader.token), route(["orders", order.id]));
    expect(JSON.stringify(await readback.json())).not.toContain("CUSTOMER-042");
  });
  it("recovers in another browser and atomically replaces the owner session with CSRF protection", async () => {
    const owner = await context.service!.createWorkspace({ name: "Recovery HTTP", recipient });
    const recovered = await POST(request("session", { token: owner.token }), route(["session"]));
    expect(recovered.status).toBe(200);
    const oldCookie = recovered.headers.get("set-cookie")!;
    const prep = request("owner-key/prepare", {});
    prep.headers.set("cookie", oldCookie);
    const prepared = await POST(prep, route(["owner-key", "prepare"]));
    expect(prepared.status).toBe(200);
    const { token } = await prepared.json();
    const crossOrigin = request("owner-key/activate", { token });
    crossOrigin.headers.set("origin", "https://evil.example");
    expect((await POST(crossOrigin, route(["owner-key", "activate"]))).status).toBeGreaterThanOrEqual(400);
    expect((await GET(request("session", undefined, owner.token), route(["session"]))).status).toBe(200);
    const activated = await POST(request("owner-key/activate", { token }), route(["owner-key", "activate"]));
    expect(activated.status).toBe(200);
    const cookie = activated.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    const stale = new Request("https://example.com/api/business/session", { headers: { cookie: oldCookie } });
    expect((await GET(stale, route(["session"]))).status).toBe(401);
    expect((await POST(request("session", { token: owner.token }), route(["session"]))).status).toBe(401);
    expect((await POST(request("session", { token }), route(["session"]))).status).toBe(200);
    expect((await POST(request("owner-key/activate", { token }), route(["owner-key", "activate"]))).status).toBe(200);
  });
  it("rejects revoked agents at the HTTP and MCP entry points", async () => {
    const owner = await context.service!.createWorkspace({ name: "Revocation HTTP", recipient });
    const principal = await context.service!.authorize(owner.token);
    const agent = await context.service!.issueReader(principal, "Revoked agent");
    expect((await POST(request("owner-key/prepare", {}, agent.token), route(["owner-key", "prepare"]))).status).toBe(403);
    const orderInput = { reference: "READ-ONLY", title: "Reader boundary", amount: "1", idempotencyKey: randomUUID() };
    const order = await context.service!.createOrder(principal, orderInput);
    for (const [path, body] of [
      ["orders", orderInput],
      [`orders/${order.id}/cancel`, {}],
      ["keys", { name: "Forbidden extra key" }],
      [`keys/${agent.key.id}/revoke`, {}],
    ] as const) {
      expect((await POST(request(path, body, agent.token), route(path.split("/")))).status).toBe(403);
    }
    expect((await context.service!.order(principal, order.id)).status).toBe("pending");
    expect((await context.service!.keys(principal)).filter(key => key.role === "reader")).toHaveLength(1);
    await context.service!.revokeKey(principal, agent.key.id);
    expect((await GET(request("orders", undefined, agent.token), route(["orders"]))).status).toBe(401);
    expect((await mcpPost(request("mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, agent.token))).status).toBe(401);
  });

  it("isolates another company's orders and keys through HTTP and remote MCP", async () => {
    const service = context.service!;
    const companyA = await service.createWorkspace({ name: "Company A", recipient });
    const companyB = await service.createWorkspace({ name: "Company B", recipient });
    const ownerA = await service.authorize(companyA.token);
    const ownerB = await service.authorize(companyB.token);
    const order = await service.createOrder(ownerA, {
      reference: "PRIVATE-A", title: "Company A only", amount: "1",
      customerReference: "CUSTOMER-A-PRIVATE", idempotencyKey: randomUUID(),
    });
    const readerA = await service.issueReader(ownerA, "A reader");
    const readerB = await service.issueReader(ownerB, "B reader");
    for (const token of [companyB.token, readerB.token]) {
      const response = await GET(request(`orders/${order.id}`, undefined, token), route(["orders", order.id]));
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("CUSTOMER-A-PRIVATE");
      const listed = await GET(request("orders", undefined, token), route(["orders"]));
      expect((await listed.json()).orders).toEqual([]);
    }
    expect((await POST(request(`orders/${order.id}/cancel`, {}, companyB.token), route(["orders", order.id, "cancel"]))).status).toBe(404);
    expect((await POST(request(`keys/${readerA.key.id}/revoke`, {}, companyB.token), route(["keys", readerA.key.id, "revoke"]))).status).toBe(404);
    const rpc = request("mcp", { jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "get_customer_order", arguments: { orderId: order.id } } }, readerB.token);
    rpc.headers.set("accept", "application/json, text/event-stream");
    rpc.headers.set("mcp-protocol-version", "2025-03-26");
    const response = await mcpPost(rpc);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body)).not.toContain("CUSTOMER-A-PRIVATE");
    expect((await service.order(ownerA, order.id)).status).toBe("pending");
    expect((await service.authorize(readerA.token)).workspace.id).toBe(companyA.workspace.id);
  });

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
