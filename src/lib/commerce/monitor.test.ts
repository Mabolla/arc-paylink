import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ARC_CHAIN_ID } from "../arc";
import { CommerceService, orderPath } from "./service";
import { MemoryStore } from "./test-store";
import { publicOrder, type Order, type Principal } from "./types";
import {
  monitorPath, readCollectionsMonitor, runCollectionsMonitor,
  type CollectionsMonitorOptions, type CollectionsMonitorState,
} from "./monitor";

const recipient = "0x1111111111111111111111111111111111111111" as const;
const sender = "0x2222222222222222222222222222222222222222" as const;
const instant = Date.parse("2026-10-01T18:00:00.000Z");

async function setup(paid = 2) {
  let clock = instant;
  const store = new MemoryStore();
  const service = new CommerceService(store, () => new Date(clock).toISOString());
  const owner = await service.createWorkspace({ name: "Internal monitor test", recipient });
  const principal = await service.authorize(owner.token);
  const reader = await service.issueReader(principal, "Monitor");
  const receiptPaths: string[] = [];
  for (let index = 0; index < paid + 2; index++) {
    const order = await service.createOrder(principal, {
      reference: `ORDER-${index}`, title: "Fixture purchase", amount: "0.01",
      customerReference: "PRIVATE-REFERENCE", dueAt: "2026-09-30T18:00:00.000Z",
      idempotencyKey: randomUUID(),
    });
    if (index < paid) {
      const transactionHash = `0x${createHash("sha256").update(order.id).digest("hex")}` as const;
      const settled: Order = { ...order, status: "paid", receipt: {
        transactionHash, sender, blockNumber: String(100 + index), confirmedAt: new Date(clock).toISOString(),
      } };
      const existing = (await store.read<Order>(orderPath(owner.workspace.id, order.id)))!;
      await store.write(orderPath(owner.workspace.id, order.id), settled, existing.version);
      const path = `merchants/${owner.workspace.id}/receipts/${String(index).padStart(5, "0")}.json`;
      await store.write(path, { eventId: `${order.id}:${transactionHash}`, type: "payment.confirmed", order: publicOrder(settled) });
      receiptPaths.push(path);
    } else if (index === paid + 1) {
      const existing = (await store.read<Order>(orderPath(owner.workspace.id, order.id)))!;
      await store.write(orderPath(owner.workspace.id, order.id), { ...order, status: "processing" }, existing.version);
    }
  }
  const options = (extra: Partial<CollectionsMonitorOptions> = {}): CollectionsMonitorOptions => ({
    readerToken: reader.token, workspaceId: owner.workspace.id, chainId: ARC_CHAIN_ID,
    now: () => clock, ...extra,
  });
  return { store, service, owner, principal, reader, receiptPaths, options, setClock: (value: number) => { clock = value; } };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

describe("server-hosted read-only collections monitor", () => {
  it("lets a valid owner or reader read reports while rejecting invalid role, tenant and chain", async () => {
    const s = await setup();
    const completed = await runCollectionsMonitor(s.service, s.options());
    const reader = await s.service.authorize(s.reader.token);
    const owner = await s.service.authorize(s.owner.token);
    expect(await readCollectionsMonitor(s.service, reader)).toEqual(completed.state);
    expect(await readCollectionsMonitor(s.service, owner)).toEqual(completed.state);
    const reads = vi.spyOn(s.store, "read");
    for (const invalid of [
      { ...reader, key: { ...reader.key, role: "unsupported" } },
      { ...reader, key: { ...reader.key, merchantId: randomUUID() } },
      { ...owner, workspace: { ...owner.workspace, chainId: ARC_CHAIN_ID + 1 } },
      { ...reader, key: { ...reader.key, revokedAt: new Date(instant).toISOString() } },
    ]) await expect(readCollectionsMonitor(s.service, invalid as Principal)).rejects.toMatchObject({ status: 403 });
    expect(reads).not.toHaveBeenCalled();
    await expect(runCollectionsMonitor(s.service, s.options({ readerToken: s.owner.token }))).rejects.toMatchObject({ status: 403 });
  });

  it("persists an exact report and deduplicates repeated scans without modifying orders or credentials", async () => {
    const s = await setup();
    const before = new Map([...s.store.data].map(([key, value]) => [key, structuredClone(value)]));
    const writes = vi.spyOn(s.store, "write");
    const first = await runCollectionsMonitor(s.service, s.options());
    expect(first.outcome).toBe("complete");
    expect(first.state).toMatchObject({ trackedReceiptCount: 2, completedScans: 1, lastSuccessfulAt: new Date(instant).toISOString(),
      summary: { count: 4, paidCount: 2, paidUsdc: "0.02", outstandingUsdc: "0.02", processing: 1, overdue: 2 },
      lastRun: { outcome: "complete", pages: 3, newReceipts: 2 },
    });
    const second = await runCollectionsMonitor(s.service, s.options());
    expect(second.state.trackedReceiptCount).toBe(2);
    expect(second.state.completedScans).toBe(2);
    expect(second.state.lastRun?.newReceipts).toBe(0);
    expect(second.state.cursor).toBeUndefined();
    expect(second.state.lease).toBeUndefined();
    expect(writes.mock.calls.every(([path]) => path.startsWith(`merchants/${s.owner.workspace.id}/monitor/`))).toBe(true);
    for (const [path, value] of before) expect(s.store.data.get(path)).toEqual(value);
    expect(JSON.stringify([...s.store.data.values()])).not.toContain(s.reader.token);
    expect(JSON.stringify(second.state)).not.toContain("PRIVATE-REFERENCE");
    expect(await readCollectionsMonitor(s.service, await s.service.authorize(s.reader.token))).toEqual(second.state);
  });

  it("allows only one simultaneous lease holder", async () => {
    const s = await setup();
    const entered = deferred();
    const release = deferred();
    const original = s.service.events.bind(s.service);
    vi.spyOn(s.service, "events").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return original(...args);
    });
    const running = runCollectionsMonitor(s.service, s.options());
    await entered.promise;
    const competitor = await runCollectionsMonitor(s.service, s.options());
    expect(competitor.outcome).toBe("busy");
    expect(competitor.state.lastRun?.outcome).toBe("running");
    release.resolve();
    expect((await running).outcome).toBe("complete");
  });

  it("resolves simultaneous first-checkpoint creation with CAS rather than overwriting", async () => {
    const s = await setup();
    const results = await Promise.all([
      runCollectionsMonitor(s.service, s.options()), runCollectionsMonitor(s.service, s.options()),
    ]);
    expect(results.map(result => result.outcome).sort()).toEqual(["busy", "complete"]);
    const state = await readCollectionsMonitor(s.service, await s.service.authorize(s.reader.token));
    expect(state?.completedScans).toBe(1);
    expect(state?.trackedReceiptCount).toBe(2);
  });

  it("fences an expired runner from committing or releasing the replacement lease", async () => {
    const s = await setup();
    const entered = deferred();
    const release = deferred();
    const original = s.service.events.bind(s.service);
    vi.spyOn(s.service, "events").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return original(...args);
    });
    const old = runCollectionsMonitor(s.service, s.options({ leaseMs: 1000 }));
    const rejected = expect(old).rejects.toMatchObject({ status: 409 });
    await entered.promise;
    s.setClock(instant + 1001);
    const replacement = await runCollectionsMonitor(s.service, s.options());
    expect(replacement.outcome).toBe("complete");
    const saved = structuredClone(s.store.data.get(monitorPath(s.owner.workspace.id)));
    release.resolve();
    await rejected;
    expect(s.store.data.get(monitorPath(s.owner.workspace.id))).toEqual(saved);
    expect(replacement.state.trackedReceiptCount).toBe(2);
  });

  it("does not renew or release a lease that expires during checkpoint authorization", async () => {
    const s = await setup(0);
    const original = s.service.authorize.bind(s.service);
    let authorizations = 0;
    vi.spyOn(s.service, "authorize").mockImplementation(async token => {
      const principal = await original(token);
      // With no events, the first authorization of the empty-page checkpoint
      // is fourth: initial, acquisition, page read, checkpoint write. Expire
      // only after checkpoint reload so the post-authorize check is exercised.
      if (++authorizations === 4) s.setClock(instant + 1001);
      return principal;
    });
    await expect(runCollectionsMonitor(s.service, s.options({ leaseMs: 1000 }))).rejects.toMatchObject({ status: 409 });
    const state = (await s.store.read<CollectionsMonitorState>(monitorPath(s.owner.workspace.id)))!.value;
    expect(state.phase).toBe("events");
    expect(state.pending).toBeUndefined();
    expect(state.lease?.expiresAt).toBe(instant + 1000);
    expect(state.lastRun?.outcome).toBe("running");
  });

  it("repairs a crash after immutable ledger appends without losing or double-counting receipts", async () => {
    const s = await setup();
    const original = s.store.write.bind(s.store);
    let failed = false;
    vi.spyOn(s.store, "write").mockImplementation(async (path, value, version) => {
      const state = value as CollectionsMonitorState;
      if (!failed && path === monitorPath(s.owner.workspace.id) && !state.pending && state.trackedReceiptCount === 2 && state.lastRun?.outcome === "running") {
        failed = true;
        throw new Error("Injected interruption before page commit");
      }
      return original(path, value, version);
    });
    await expect(runCollectionsMonitor(s.service, s.options())).rejects.toThrow("Injected interruption");
    const interrupted = await readCollectionsMonitor(s.service, await s.service.authorize(s.reader.token));
    expect(interrupted?.trackedReceiptCount).toBe(0);
    expect(interrupted?.pending?.newEventIds).toHaveLength(2);
    expect(interrupted?.lastRun?.outcome).toBe("failed");
    expect([...s.store.data.keys()].filter(path => path.includes("/monitor/events/"))).toHaveLength(2);
    const recovered = await runCollectionsMonitor(s.service, s.options());
    expect(recovered.outcome).toBe("complete");
    expect(recovered.state.trackedReceiptCount).toBe(2);
    expect(recovered.state.pending).toBeUndefined();
    expect((await runCollectionsMonitor(s.service, s.options())).state.trackedReceiptCount).toBe(2);
  });

  it("stops at page bounds and resumes both receipt and summary cursors", async () => {
    const s = await setup(3);
    const states: CollectionsMonitorState[] = [];
    for (let index = 0; index < 5; index++) states.push((await runCollectionsMonitor(s.service, s.options({ maxPages: 1 }))).state);
    expect(states[0]).toMatchObject({ phase: "events", cursor: "2", trackedReceiptCount: 2, lastRun: { outcome: "partial", pages: 1 } });
    expect(states[1]).toMatchObject({ phase: "summary", trackedReceiptCount: 3, aggregate: { count: 0 } });
    expect(states[2]).toMatchObject({ phase: "summary", aggregate: { count: 2, cursor: "2" } });
    expect(states[3]).toMatchObject({ phase: "summary", aggregate: { count: 4, cursor: "4" } });
    expect(states[4]).toMatchObject({ phase: "events", completedScans: 1, summary: { count: 5, paidUsdc: "0.03", outstandingUsdc: "0.02" } });
    expect(states[4].cursor).toBeUndefined();
    expect((await runCollectionsMonitor(s.service, s.options())).state.lastRun?.newReceipts).toBe(0);
  });

  it("honors the deadline between event writes and repairs a partially appended page later", async () => {
    const s = await setup();
    const original = s.store.write.bind(s.store);
    let advanced = false;
    vi.spyOn(s.store, "write").mockImplementation(async (...args) => {
      await original(...args);
      if (!advanced && args[0].includes("/monitor/events/")) { advanced = true; s.setClock(instant + 101); }
    });
    const limited = await runCollectionsMonitor(s.service, s.options({ deadlineMs: instant + 100 }));
    expect(limited.outcome).toBe("partial");
    expect(limited.state.pending).toBeDefined();
    expect(limited.state.trackedReceiptCount).toBe(0);
    expect([...s.store.data.keys()].filter(path => path.includes("/monitor/events/"))).toHaveLength(1);
    const recovered = await runCollectionsMonitor(s.service, s.options());
    expect(recovered.state.trackedReceiptCount).toBe(2);
    expect(recovered.outcome).toBe("complete");
  });

  it("stops progress writes when checkpoint authorization crosses its deadline", async () => {
    const s = await setup(0);
    const original = s.service.authorize.bind(s.service);
    let authorizations = 0;
    vi.spyOn(s.service, "authorize").mockImplementation(async token => {
      const principal = await original(token);
      if (++authorizations === 4) s.setClock(instant + 101);
      return principal;
    });
    const result = await runCollectionsMonitor(s.service, s.options({ deadlineMs: instant + 100 }));
    expect(result.outcome).toBe("partial");
    expect(result.state.pending).toBeUndefined();
    expect(result.state.phase).toBe("events");
    expect(result.state.lastRun?.pages).toBe(0);
    expect(result.state.lease).toBeUndefined();
  });

  it("does not append an immutable receipt after its final authorization crosses the deadline", async () => {
    const s = await setup(1);
    const original = s.service.authorize.bind(s.service);
    let pendingAuthorizations = 0;
    vi.spyOn(s.service, "authorize").mockImplementation(async token => {
      const principal = await original(token);
      const state = (await s.store.read<CollectionsMonitorState>(monitorPath(s.owner.workspace.id)))?.value;
      if (state?.pending && ++pendingAuthorizations === 2) s.setClock(instant + 101);
      return principal;
    });
    const result = await runCollectionsMonitor(s.service, s.options({ deadlineMs: instant + 100 }));
    expect(result.outcome).toBe("partial");
    expect(result.state.pending?.newEventIds).toHaveLength(1);
    expect(result.state.trackedReceiptCount).toBe(0);
    expect([...s.store.data.keys()].filter(path => path.includes("/monitor/events/"))).toHaveLength(0);
    expect((await runCollectionsMonitor(s.service, s.options())).state.trackedReceiptCount).toBe(1);
  });

  it("rechecks revocation before checkpoints and does not release or append with a revoked key", async () => {
    const s = await setup();
    const original = s.service.events.bind(s.service);
    vi.spyOn(s.service, "events").mockImplementationOnce(async (...args) => {
      const events = await original(...args);
      await s.service.revokeKey(s.principal, s.reader.key.id);
      return events;
    });
    await expect(runCollectionsMonitor(s.service, s.options())).rejects.toMatchObject({ status: 401 });
    const saved = (await s.store.read<CollectionsMonitorState>(monitorPath(s.owner.workspace.id)))!.value;
    expect(saved.lastRun?.outcome).toBe("running");
    expect(saved.pending).toBeUndefined();
    expect(saved.trackedReceiptCount).toBe(0);
    expect([...s.store.data.keys()].filter(path => path.includes("/monitor/events/"))).toHaveLength(0);
  });

  it("rejects owner credentials, wrong configured tenant/chain and copied checkpoints", async () => {
    const s = await setup();
    const writes = vi.spyOn(s.store, "write");
    for (const extra of [
      { readerToken: s.owner.token }, { workspaceId: randomUUID() }, { chainId: ARC_CHAIN_ID + 1 },
    ]) await expect(runCollectionsMonitor(s.service, s.options(extra))).rejects.toMatchObject({ status: 403 });
    expect(writes).not.toHaveBeenCalled();
    const run = await runCollectionsMonitor(s.service, s.options());
    const current = (await s.store.read<CollectionsMonitorState>(monitorPath(s.owner.workspace.id)))!;
    await s.store.write(monitorPath(s.owner.workspace.id), { ...run.state, workspaceId: randomUUID() }, current.version);
    await expect(runCollectionsMonitor(s.service, s.options())).rejects.toThrow("checkpoint identity");
  });

  it("preserves an immutable ledger proof and prior successful report when a receipt changes", async () => {
    const s = await setup();
    const initial = await runCollectionsMonitor(s.service, s.options());
    const ledger = structuredClone([...s.store.data].filter(([path]) => path.includes("/monitor/events/")));
    const saved = (await s.store.read<{ order: Order }>(s.receiptPaths[0]))!;
    await s.store.write(s.receiptPaths[0], { ...saved.value, order: { ...saved.value.order, amount: "0.02" } }, saved.version);
    await expect(runCollectionsMonitor(s.service, s.options())).rejects.toThrow("conflicting receipt proof");
    expect([...s.store.data].filter(([path]) => path.includes("/monitor/events/"))).toEqual(ledger);
    const failed = await readCollectionsMonitor(s.service, await s.service.authorize(s.reader.token));
    expect(failed?.summary).toEqual(initial.state.summary);
    expect(failed?.lastSuccessfulAt).toBe(initial.state.lastSuccessfulAt);
    expect(failed?.lastRun?.outcome).toBe("failed");
    expect(failed?.trackedReceiptCount).toBe(2);
  });
});
