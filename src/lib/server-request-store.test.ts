import { describe, expect, it } from "vitest";
import { createManagedRequest } from "./request-lifecycle";
import { appendRequestEvent, claimSettlementTransaction, createRequestRecord, loadRequestRecord } from "./server-request-store";

function memory() {
  const values = new Map<string, string>();
  return { values, store: { list: async (prefix: string) => [...values.keys()].filter((key) => key.startsWith(prefix)), read: async (path: string) => JSON.parse(values.get(path)!), put: async (path: string, body: string) => { if (values.has(path)) throw new Error("overwrite"); values.set(path, body); } } };
}

describe("server request store", () => {
  it("preserves the request and append-only idempotent events", async () => {
    const { values, store } = memory();
    const record = createManagedRequest({ requestId: "22222222-2222-4222-8222-222222222222", managementToken: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-02T12:00:00Z", title: "Work", amount: "1", recipient: "0x0000000000000000000000000000000000000001", obligationKind: "invoice", obligationId: "INV-1" });
    await createRequestRecord(record, store);
    await appendRequestEvent(record.requestId, { type: "revoked", createdAt: "2026-09-02T12:01:00Z" }, "revoke", store);
    await appendRequestEvent(record.requestId, { type: "revoked", createdAt: "2026-09-02T12:01:00Z" }, "revoke", store);
    expect(values.size).toBe(2);
    expect((await loadRequestRecord(record.requestId, store))?.events).toHaveLength(1);
  });
});

describe("claimSettlementTransaction", () => {
  const hash = `0x${"1".repeat(64)}` as const;

  it("binds one chain transaction to one managed request", async () => {
    const data = new Map<string, string>();
    const store = {
      async list(prefix: string) { return [...data.keys()].filter((key) => key.startsWith(prefix)); },
      async read(path: string) { const value = data.get(path); return value ? JSON.parse(value) : undefined; },
      async put(path: string, body: string) { if (data.has(path)) throw new Error("exists"); data.set(path, body); },
    };
    await claimSettlementTransaction("request-a", hash, store);
    await expect(claimSettlementTransaction("request-a", hash, store)).resolves.toBeUndefined();
    await expect(claimSettlementTransaction("request-b", hash, store)).rejects.toThrow("already assigned");
    expect([...data.keys()][0]).toContain("settlement-claims/v1/chain-5042002/");
  });
});
