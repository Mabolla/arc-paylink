import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createMerchantMcp } from "./mcp";
import { monitorPath, type CollectionsMonitorState } from "./monitor";
import { CommerceService } from "./service";
import { MemoryStore } from "./test-store";
import type { Principal } from "./types";

const now = "2026-10-01T18:00:00.000Z";
const recipient = "0x1111111111111111111111111111111111111111";

function stateFor(principal: Principal, paidCount: number): CollectionsMonitorState {
  return {
    version: 1,
    workspaceId: principal.workspace.id,
    chainId: principal.workspace.chainId,
    phase: "events",
    cursor: "PRIVATE-CURSOR",
    trackedReceiptCount: paidCount,
    completedScans: 1,
    lastSuccessfulAt: now,
    lastReceiptScanAt: now,
    summary: {
      count: paidCount,
      paidCount,
      processing: 0,
      overdue: 0,
      paidUsdc: String(paidCount),
      outstandingUsdc: "0",
      chainId: principal.workspace.chainId,
      asOf: now,
    },
    lease: { id: randomUUID(), expiresAt: Date.parse(now) + 120_000 },
    lastRun: {
      id: randomUUID(),
      startedAt: now,
      outcome: "running",
      pages: 0,
      newReceipts: 0,
    },
  };
}

async function readTool(service: CommerceService, principal: Principal) {
  const server = createMerchantMcp(service, principal);
  const client = new Client({ name: "monitor-reader-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    return await client.callTool({ name: "get_collections_monitor", arguments: {} });
  } finally {
    await client.close();
    await server.close();
  }
}

describe("merchant monitor MCP report", () => {
  it("returns only the authenticated business's safe saved report without any writes", async () => {
    const store = new MemoryStore();
    const service = new CommerceService(store, () => now);
    const a = await service.createWorkspace({ name: "Company A", recipient });
    const b = await service.createWorkspace({ name: "Company B", recipient });
    const ownerA = await service.authorize(a.token);
    const ownerB = await service.authorize(b.token);
    const keyA = await service.issueReader(ownerA, "Agent A");
    const readerA = await service.authorize(keyA.token);
    await store.write(monitorPath(ownerA.workspace.id), stateFor(ownerA, 2));
    await store.write(monitorPath(ownerB.workspace.id), stateFor(ownerB, 9));
    const writes = vi.spyOn(store, "write");

    for (const principal of [readerA, ownerA]) {
      const response = await readTool(service, principal);
      expect(response.isError).not.toBe(true);
      const serialized = JSON.stringify(response.content);
      const text = (response.content as Array<{ type: string; text: string }>)[0].text;
      const report = JSON.parse(text).monitor;
      expect(report).toMatchObject({
        trackedReceipts: 2,
        completedScans: 1,
        lastCompletedAt: now,
        paidOrders: 2,
        paidUsdc: "2",
      });
      expect(report).not.toHaveProperty("lease");
      expect(report).not.toHaveProperty("cursor");
      expect(report).not.toHaveProperty("pending");
      expect(serialized).not.toContain("PRIVATE-CURSOR");
      expect(serialized).not.toContain(keyA.token);
      expect(serialized).not.toContain(ownerB.workspace.id);
    }
    const otherResponse = await readTool(service, ownerB);
    const otherText = (otherResponse.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(otherText).monitor.trackedReceipts).toBe(9);
    expect(writes).not.toHaveBeenCalled();
  });

  it("rejects a saved checkpoint with a different tenant through a sanitized protocol error", async () => {
    const store = new MemoryStore();
    const service = new CommerceService(store, () => now);
    const created = await service.createWorkspace({ name: "Company", recipient });
    const principal = await service.authorize(created.token);
    await store.write(monitorPath(principal.workspace.id), {
      ...stateFor(principal, 2), workspaceId: randomUUID(),
    });
    const writes = vi.spyOn(store, "write");
    const response = await readTool(service, principal);
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([{
      type: "text",
      text: '{"error":"Unable to read this business record. Check the ID and access key."}',
    }]);
    expect(writes).not.toHaveBeenCalled();
  });
});
