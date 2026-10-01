import { describe, it, expect, vi } from "vitest";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CommerceService,
  ordersCsv,
  orderPath,
  merchantOrder,
} from "./service";
import { MemoryStore } from "./test-store";
import { CheckoutPayments, type CheckoutProvider } from "./payments";
import { createMerchantMcp } from "./mcp";
import { publicOrder, type Order } from "./types";
import { applyCircleNotification, verifyCircleSignature } from "./webhook";
import { IS_ARC_MAINNET } from "../arc";

const recipient = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";
const walletId = "715592c1-7f37-4a6f-896c-2488df517cf6";
const challengeId = "6a44477f-35c1-4bdf-80f6-293fed7c615a";
const txId = "95f49099-854e-4d45-8aa5-2ecf3f09854e";
const hash = `0x${"a".repeat(64)}` as const;
const now = "2026-10-01T12:00:00.000Z";
async function setup() {
  const store = new MemoryStore();
  const service = new CommerceService(store, () => now);
  const owner = await service.createWorkspace({
    name: "Example Studio",
    recipient,
  });
  const principal = await service.authorize(owner.token);
  const input = {
    reference: "INV-1001",
    title: "Service",
    amount: "5.00",
    customerReference: "PRIVATE-ACME",
    idempotencyKey: randomUUID(),
  };
  const order = await service.createOrder(principal, input);
  const provider: CheckoutProvider = {
    wallet: vi.fn<CheckoutProvider["wallet"]>(async (_token, id) => ({
      id,
      address: sender,
    })),
    prepare: vi.fn(async () => challengeId),
    transaction: vi.fn(async () => hash),
    transactionIds: vi.fn(async () => [txId]),
    verify: vi.fn<CheckoutProvider["verify"]>(async () => ({
      transactionHash: hash,
      sender,
      blockNumber: "100",
      timestamp: Date.parse(now) / 1000 + 1,
    })),
  };
  const payments = new CheckoutPayments(service, provider);
  return { store, service, owner, principal, input, order, provider, payments };
}

describe("business identity and orders", () => {
  it("stores only credential hashes, scopes orders and excludes private customer fields from public checkout", async () => {
    const s = await setup();
    expect(JSON.stringify([...s.store.data.values()])).not.toContain(
      s.owner.token,
    );
    const other = await s.service.createWorkspace({ name: "Other", recipient });
    await expect(
      s.service.order(await s.service.authorize(other.token), s.order.id),
    ).rejects.toThrow("not found");
    expect(publicOrder(s.order)).not.toHaveProperty("customerReference");
    expect(publicOrder(s.order)).not.toHaveProperty("attempt");
    expect(merchantOrder(s.order).customerReference).toBe("PRIVATE-ACME");
  });
  it("allows reader queries, denies writes and applies revocation to the next request", async () => {
    const s = await setup();
    const key = await s.service.issueReader(s.principal, "Accounts agent");
    const reader = await s.service.authorize(key.token);
    expect((await s.service.listOrders(reader)).orders).toHaveLength(1);
    await expect(s.service.createOrder(reader, s.input)).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.service.cancel(reader, s.order.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.service.issueReader(reader, "Extra")).rejects.toMatchObject({
      status: 403,
    });
    await s.service.revokeKey(s.principal, key.key.id);
    await expect(s.service.authorize(key.token)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      s.service.authorize(s.owner.token + "x"),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("retries the same order without duplication and rejects changed amount or duplicate business reference", async () => {
    const s = await setup();
    expect((await s.service.createOrder(s.principal, s.input)).id).toBe(
      s.order.id,
    );
    await expect(
      s.service.createOrder(s.principal, { ...s.input, amount: "6" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      s.service.createOrder(s.principal, {
        ...s.input,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await s.service.listOrders(s.principal)).orders).toHaveLength(1);
  });
  it("aggregates exact USDC amounts across storage pages and reports overdue records", async () => {
    const s = await setup();
    for (let i = 0; i < 4; i++)
      await s.service.createOrder(s.principal, {
        ...s.input,
        reference: `INV-${i}`,
        amount: "0.000001",
        dueAt: "2026-09-01T00:00:00Z",
        idempotencyKey: randomUUID(),
      });
    expect(await s.service.summary(s.principal)).toMatchObject({
      count: 5,
      outstandingUsdc: "5.000004",
      overdue: 4,
    });
    const page = await s.service.listOrders(s.principal);
    expect(page.cursor).toBeDefined();
    expect(
      (await s.service.listOrders(s.principal, page.cursor)).orders,
    ).toHaveLength(2);
  });
  it("cancels unpaid orders and neutralizes spreadsheet formulas in exports", async () => {
    const s = await setup();
    await s.service.cancel(s.principal, s.order.id);
    await expect(
      s.payments.prepare(s.order.id, "session", walletId),
    ).rejects.toThrow("cancelled");
    expect(
      ordersCsv([{ ...s.order, reference: '=HYPERLINK("evil")' }]),
    ).toContain("'=HYPERLINK");
  });
});

describe("embedded purchase lifecycle", () => {
  it("reserves before provider call and reuses the saved approval without sending twice", async () => {
    const s = await setup();
    vi.mocked(s.provider.prepare).mockImplementation(async (_token, order) => {
      expect((await s.service.checkout(order.id)).value.status).toBe(
        "processing",
      );
      return challengeId;
    });
    await s.payments.prepare(s.order.id, "session", walletId);
    await s.payments.prepare(s.order.id, "session", walletId);
    expect(s.provider.prepare).toHaveBeenCalledTimes(1);
    expect(
      (
        await s.store.read<{ orderId: string }>(
          `circle-transactions/${txId}.json`,
        )
      )?.value.orderId,
    ).toBe(s.order.id);
  });
  it("rejects a concurrent second payer and cancellation while an approval is outstanding", async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.payments.prepare(s.order.id, "one", walletId),
      s.payments.prepare(s.order.id, "two", randomUUID()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(s.provider.prepare).toHaveBeenCalledTimes(1);
    await expect(
      s.service.cancel(s.principal, s.order.id),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("recovers a provider timeout with the original idempotency key", async () => {
    const s = await setup();
    vi.mocked(s.provider.prepare).mockRejectedValueOnce(new Error("timeout"));
    await expect(
      s.payments.prepare(s.order.id, "session", walletId),
    ).rejects.toThrow("timeout");
    const first = (await s.service.checkout(s.order.id)).value.attempt!
      .idempotencyKey;
    await s.payments.prepare(s.order.id, "session", walletId);
    expect(
      vi.mocked(s.provider.prepare).mock.calls[1][1].attempt!.idempotencyKey,
    ).toBe(first);
  });
  it("does not create a new provider request after the recovery window", async () => {
    const s = await setup();
    vi.mocked(s.provider.prepare).mockRejectedValueOnce(new Error("timeout"));
    await expect(
      s.payments.prepare(s.order.id, "session", walletId),
    ).rejects.toThrow();
    s.service.now = () => "2026-10-03T12:00:00.000Z";
    await expect(
      s.payments.prepare(s.order.id, "session", walletId),
    ).rejects.toThrow("reconciliation");
    expect(s.provider.prepare).toHaveBeenCalledTimes(1);
  });
  it("reconciles after restart, writes one receipt event and never calls transfer preparation again", async () => {
    const s = await setup();
    await s.payments.prepare(s.order.id, "session", walletId);
    const restarted = new CheckoutPayments(
      new CommerceService(s.store, () => now),
      s.provider,
    );
    expect(
      (await restarted.reconcile(s.order.id, "session", walletId)).status,
    ).toBe("paid");
    await restarted.reconcile(s.order.id, "session", walletId);
    expect(s.provider.prepare).toHaveBeenCalledTimes(1);
    expect((await s.service.events(s.principal)).events).toHaveLength(1);
    expect(await s.service.summary(s.principal)).toMatchObject({
      paidUsdc: "5",
      outstandingUsdc: "0",
    });
  });
  it.each(["sender", "timestamp", "transactionHash"])(
    "rejects wrong %s proof",
    async (field) => {
      const s = await setup();
      await s.payments.prepare(s.order.id, "session", walletId);
      const proof = {
        transactionHash: hash,
        sender: sender as `0x${string}`,
        blockNumber: "100",
        timestamp: Date.parse(now) / 1000 + 1,
      };
      if (field === "sender") proof.sender = recipient;
      if (field === "timestamp") proof.timestamp = 1;
      if (field === "transactionHash")
        proof.transactionHash = `0x${"b".repeat(64)}`;
      vi.mocked(s.provider.verify).mockResolvedValue(proof);
      await expect(
        s.payments.reconcile(s.order.id, "session", walletId),
      ).rejects.toThrow("does not match");
      expect((await s.service.checkout(s.order.id)).value.status).toBe(
        "processing",
      );
    },
  );
  it("fails closed on RPC outage and prevents receipt reuse across orders", async () => {
    const s = await setup();
    await s.payments.prepare(s.order.id, "session", walletId);
    vi.mocked(s.provider.verify).mockRejectedValueOnce(
      new Error("RPC unavailable"),
    );
    await expect(
      s.payments.reconcile(s.order.id, "session", walletId),
    ).rejects.toThrow("RPC");
    await s.payments.reconcile(s.order.id, "session", walletId);
    const other = await s.service.createOrder(s.principal, {
      ...s.input,
      reference: "INV-OTHER",
      idempotencyKey: randomUUID(),
    });
    vi.mocked(s.provider.transactionIds!).mockResolvedValue([]);
    await s.payments.prepare(other.id, "session", walletId);
    await expect(
      s.payments.reconcile(other.id, "session", walletId),
    ).rejects.toThrow("another order");
  });
  it("rebuilds an event if storage fails after the payment is recorded", async () => {
    const s = await setup();
    await s.payments.prepare(s.order.id, "session", walletId);
    const write = s.store.write.bind(s.store);
    let fail = true;
    vi.spyOn(s.store, "write").mockImplementation(
      async (path, value, version) => {
        if (path.includes("/receipts/") && fail) {
          fail = false;
          throw new Error("storage outage");
        }
        return write(path, value, version);
      },
    );
    await expect(
      s.payments.reconcile(s.order.id, "session", walletId),
    ).rejects.toThrow("storage outage");
    expect(
      (
        await s.store.read<Order>(
          orderPath(s.principal.workspace.id, s.order.id),
        )
      )?.value.status,
    ).toBe("paid");
    await s.payments.reconcile(s.order.id, "session", walletId);
    expect((await s.service.events(s.principal)).events).toHaveLength(1);
  });
});

describe("company agent and signed background updates", () => {
  it("serves real MCP tools with only the connected business's data", async () => {
    const s = await setup();
    const server = createMerchantMcp(s.service, s.principal);
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      "list_customer_orders",
      "get_customer_order",
      "get_receivables_summary",
      "list_payment_events",
      "get_collections_monitor",
    ]);
    const result = await client.callTool({
      name: "get_receivables_summary",
      arguments: {},
    });
    expect(JSON.stringify(result)).toContain("outstandingUsdc");
    const monitor = await client.callTool({
      name: "get_collections_monitor",
      arguments: {},
    });
    expect(monitor.isError).not.toBe(true);
    expect(monitor.content).toEqual([{ type: "text", text: '{"monitor":null}' }]);
    const missing = await client.callTool({
      name: "get_customer_order",
      arguments: { orderId: randomUUID() },
    });
    expect(missing.isError).toBe(true);
    await client.close();
    await server.close();
  });
  it("checks ECDSA signatures over the original bytes and rejects a modified body", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const key = {
      algorithm: "ECDSA_SHA_256",
      publicKey: publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    };
    const raw = '{ "notificationType": "webhooks.test" }';
    const signature = sign("SHA256", Buffer.from(raw), privateKey).toString(
      "base64",
    );
    expect(verifyCircleSignature(raw, signature, key)).toBe(true);
    expect(verifyCircleSignature(raw + " ", signature, key)).toBe(false);
    expect(
      verifyCircleSignature(raw, signature, { ...key, algorithm: "none" }),
    ).toBe(false);
  });
  it("settles a correlated webhook without the customer browser and handles replay idempotently", async () => {
    const s = await setup();
    await s.payments.prepare(s.order.id, "session", walletId);
    const event = {
      notificationId: randomUUID(),
      notificationType: "transactions.outbound",
      notification: {
        id: txId,
        walletId,
        blockchain: IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET",
        state: "COMPLETE",
        txHash: hash,
      },
    };
    await applyCircleNotification(event, s.payments);
    await applyCircleNotification(event, s.payments);
    expect((await s.service.checkout(s.order.id)).value.status).toBe("paid");
    expect((await s.service.events(s.principal)).events).toHaveLength(1);
    expect(s.provider.prepare).toHaveBeenCalledTimes(1);
  });
});
