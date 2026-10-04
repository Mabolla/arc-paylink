import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { CommerceService } from "./service";
import { MemoryStore } from "./test-store";

async function setup() {
  let now = "2026-10-04T00:00:00.000Z";
  const store = new MemoryStore();
  const service = new CommerceService(store, () => now);
  const owner = await service.createWorkspace({ name: "Recovery test", recipient: "0x1111111111111111111111111111111111111111" });
  const principal = await service.authorize(owner.token);
  return { store, service, owner, principal, advance: () => { now = "2026-10-04T00:30:00.000Z"; } };
}

describe("owner recovery key renewal", () => {
  it("keeps the old key until activation, then preserves orders and reader access while invalidating old sessions", async () => {
    const s = await setup();
    const order = await s.service.createOrder(s.principal, { reference: "REC-1", title: "Recovery", amount: "1", idempotencyKey: randomUUID() });
    const reader = await s.service.issueReader(s.principal, "Agent");
    const candidate = await s.service.prepareOwnerRotation(s.principal);
    expect((await s.service.authorize(s.owner.token)).workspace.id).toBe(s.owner.workspace.id);
    await expect(s.service.authorize(candidate.token)).rejects.toMatchObject({ status: 401 });
    expect(JSON.stringify([...s.store.data.values()])).not.toContain(candidate.token);
    expect(JSON.stringify(await s.service.keys(s.principal))).not.toContain("pendingOwnerHash");
    const renewed = await s.service.activateOwnerRotation(candidate.token);
    expect((await s.service.authorize(candidate.token)).key.id).toBe(s.principal.key.id);
    await expect(s.service.authorize(s.owner.token)).rejects.toMatchObject({ status: 401 });
    await expect(s.service.prepareOwnerRotation(s.principal)).rejects.toMatchObject({ status: 401 });
    expect((await s.service.order(renewed, order.id)).id).toBe(order.id);
    expect((await s.service.listOrders(await s.service.authorize(reader.token))).orders).toHaveLength(1);
    expect((await s.service.activateOwnerRotation(candidate.token)).workspace.id).toBe(s.owner.workspace.id);
    await s.service.revokeKey(renewed, reader.key.id);
    await expect(s.service.authorize(reader.token)).rejects.toMatchObject({ status: 401 });
  });
  it("rejects superseded and expired candidates without locking out the owner", async () => {
    const s = await setup();
    const first = await s.service.prepareOwnerRotation(s.principal);
    const second = await s.service.prepareOwnerRotation(s.principal);
    await expect(s.service.activateOwnerRotation(first.token)).rejects.toMatchObject({ status: 401 });
    s.advance();
    await expect(s.service.activateOwnerRotation(second.token)).rejects.toMatchObject({ status: 401 });
    expect((await s.service.authorize(s.owner.token)).key.role).toBe("owner");
  });
  it("denies reader renewal and activation and malformed or altered credentials", async () => {
    const s = await setup();
    const reader = await s.service.issueReader(s.principal, "Agent");
    await expect(s.service.prepareOwnerRotation(await s.service.authorize(reader.token))).rejects.toMatchObject({ status: 403 });
    await expect(s.service.activateOwnerRotation(reader.token)).rejects.toMatchObject({ status: 401 });
    const candidate = await s.service.prepareOwnerRotation(s.principal);
    for (const token of ["", "apm_invalid", candidate.token.slice(0, -1) + (candidate.token.endsWith("A") ? "B" : "A")])
      await expect(s.service.activateOwnerRotation(token)).rejects.toMatchObject({ status: 401 });
  });
  it("preserves the old key if storage fails and allows recovery after retry", async () => {
    const s = await setup();
    const candidate = await s.service.prepareOwnerRotation(s.principal);
    const write = vi.spyOn(s.store, "write").mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(s.service.activateOwnerRotation(candidate.token)).rejects.toThrow("Storage unavailable");
    expect((await s.service.authorize(s.owner.token)).key.role).toBe("owner");
    write.mockRestore();
    await s.service.activateOwnerRotation(candidate.token);
    expect((await s.service.authorize(candidate.token)).key.role).toBe("owner");
  });
  it("uses conditional writes when concurrent activations race", async () => {
    const s = await setup();
    const candidate = await s.service.prepareOwnerRotation(s.principal);
    const results = await Promise.allSettled([s.service.activateOwnerRotation(candidate.token), s.service.activateOwnerRotation(candidate.token)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const result of results) if (result.status === "rejected") expect(result.reason.status).toBe(409);
    expect((await s.service.activateOwnerRotation(candidate.token)).key.role).toBe("owner");
    await expect(s.service.authorize(s.owner.token)).rejects.toMatchObject({ status: 401 });
  });
});
