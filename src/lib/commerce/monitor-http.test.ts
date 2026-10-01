import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARC_CHAIN_ID } from "../arc";
import { CommerceService } from "./service";
import { MemoryStore } from "./test-store";
import * as monitoring from "./monitor";
import {
  authorizeCronRequest,
  cronMonitorConfig,
  monitorReport,
  monitorStatus,
  runCronCollectionsMonitor,
  runOwnerMonitorRefresh,
} from "./monitor-http";

const recipient = "0x1111111111111111111111111111111111111111";
const now = Date.parse("2026-10-01T20:00:00Z");

async function fixture() {
  const service = new CommerceService(new MemoryStore());
  const created = await service.createWorkspace({ name: "Monitor HTTP QA", recipient });
  const owner = await service.authorize(created.token);
  const reader = await service.issueReader(owner, "Background reporting");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    CRON_SECRET: randomBytes(32).toString("base64url"),
    ARCPAYLINK_COLLECTIONS_READER_KEY: reader.token,
    ARCPAYLINK_COLLECTIONS_WORKSPACE_ID: created.workspace.id,
  };
  return { service, created, owner, reader, env };
}

function request(secret?: string, headers?: Record<string, string>) {
  return new Request("https://example.com/api/business/monitor/cron", {
    headers: { ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...headers },
  });
}

function state(workspaceId: string = randomUUID()): monitoring.CollectionsMonitorState {
  return {
    version: 1, workspaceId, chainId: ARC_CHAIN_ID, phase: "events",
    trackedReceiptCount: 3, completedScans: 2,
    lastReceiptScanAt: "2026-10-01T19:58:00Z",
    lastSuccessfulAt: "2026-10-01T19:59:00Z",
    lastRun: {
      id: randomUUID(), startedAt: "2026-10-01T19:58:00Z", finishedAt: "2026-10-01T19:59:00Z",
      outcome: "complete", pages: 2, newReceipts: 1,
    },
    summary: {
      count: 5, paidCount: 3, processing: 1, overdue: 1,
      paidUsdc: "12.5", outstandingUsdc: "7.5", chainId: ARC_CHAIN_ID, asOf: "2026-10-01T19:59:00Z",
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("hosted collections monitor HTTP boundaries", () => {
  it("requires a dedicated strong cron secret and a specific reader/workspace configuration", async () => {
    const f = await fixture();
    expect(cronMonitorConfig(f.env)).toMatchObject({
      secret: f.env.CRON_SECRET, readerToken: f.reader.token,
      workspaceId: f.created.workspace.id, chainId: ARC_CHAIN_ID,
    });
    const invalid: NodeJS.ProcessEnv[] = [
      { ...f.env, CRON_SECRET: undefined },
      { ...f.env, CRON_SECRET: "short" },
      { ...f.env, CRON_SECRET: "a".repeat(129) },
      { ...f.env, CRON_SECRET: " ".repeat(64) },
      { ...f.env, CIRCLE_API_KEY: f.env.CRON_SECRET },
      { ...f.env, SERVER_PASSWORD: f.env.CRON_SECRET },
      { ...f.env, SESSION_TOKEN: f.env.CRON_SECRET },
      { ...f.env, ARCPAYLINK_COLLECTIONS_READER_KEY: undefined },
      { ...f.env, ARCPAYLINK_COLLECTIONS_WORKSPACE_ID: "untrusted-workspace" },
    ];
    for (const env of invalid) {
      let error: unknown;
      try { cronMonitorConfig(env); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ status: 503 });
      expect(String(error)).not.toContain(f.reader.token);
      expect(String(error)).not.toContain(f.env.CRON_SECRET!);
    }
  });

  it("uses exact Bearer authorization and never a merchant cookie fallback", async () => {
    const f = await fixture();
    expect(authorizeCronRequest(request(f.env.CRON_SECRET), f.env)).toMatchObject({ workspaceId: f.owner.workspace.id });
    for (const req of [
      request(),
      request(undefined, { cookie: `arcpaylink_business=${f.env.CRON_SECRET}` }),
      request(undefined, { authorization: `bearer ${f.env.CRON_SECRET}` }),
      request(undefined, { authorization: `Bearer  ${f.env.CRON_SECRET}` }),
      request(undefined, { authorization: `Basic ${f.env.CRON_SECRET}`, cookie: `arcpaylink_business=${f.created.token}` }),
      request(f.reader.token),
      request(`${f.env.CRON_SECRET}x`),
    ]) {
      expect(() => authorizeCronRequest(req, f.env)).toThrow();
      try { authorizeCronRequest(req, f.env); }
      catch (error) { expect(error).toMatchObject({ status: 401 }); }
    }
  });

  it("returns an allowlisted report without checkpoint, lease or receipt-page contents", () => {
    expect(monitorReport(undefined, now)).toBeNull();
    const saved = state();
    saved.cursor = "private-checkpoint-cursor";
    saved.lease = { id: randomUUID(), expiresAt: now + 60_000 };
    const orderId = randomUUID();
    const txHash = `0x${"a".repeat(64)}`;
    saved.pending = {
      cursor: saved.cursor,
      events: [{
        eventId: `${orderId}:${txHash}`,
        type: "payment.confirmed",
        order: {
          id: orderId, merchantName: "private merchant name", reference: "private customer reference",
          title: "private order title", amount: "1", recipient, chainId: ARC_CHAIN_ID,
          createdAt: "2026-10-01T19:00:00Z", status: "paid",
          receipt: { transactionHash: txHash, sender: recipient, blockNumber: "123", confirmedAt: "2026-10-01T19:58:00Z" },
        },
      }],
      newEventIds: [`${orderId}:${txHash}`],
    };
    const report = monitorReport(saved, now);
    expect(report).toMatchObject({ trackedReceipts: 3, chainId: ARC_CHAIN_ID, paidUsdc: "12.5", outstandingUsdc: "7.5" });
    expect(Object.keys(report!)).toEqual(expect.arrayContaining(["outcome", "trackedReceipts", "chainId"]));
    const permitted = new Set(["lastCompletedAt", "lastStartedAt", "outcome", "trackedReceipts", "completedScans", "newReceipts", "summaryAsOf", "paidUsdc", "outstandingUsdc", "chainId", "orders", "paidOrders", "processingOrders", "overdueOrders"]);
    expect(Object.keys(report!).every(key => permitted.has(key))).toBe(true);
    const serialized = JSON.stringify(report);
    for (const privateValue of [saved.cursor, saved.lease.id, saved.workspaceId, orderId, txHash, "private customer reference", "private order title"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("checks a configured read-only key against the requesting business before claiming scheduling is active", async () => {
    const f = await fixture();
    expect(await monitorStatus(f.service, f.owner, f.env)).toMatchObject({ schedulingConfigured: true, monitor: null });
    expect(await monitorStatus(f.service, f.owner, { ...f.env, ARCPAYLINK_COLLECTIONS_READER_KEY: f.created.token })).toMatchObject({ schedulingConfigured: false });
    const other = await f.service.createWorkspace({ name: "Another business", recipient });
    const otherOwner = await f.service.authorize(other.token);
    expect(await monitorStatus(f.service, otherOwner, f.env)).toMatchObject({ schedulingConfigured: false });
    await f.service.revokeKey(f.owner, f.reader.key.id);
    expect(await monitorStatus(f.service, f.owner, f.env)).toMatchObject({ schedulingConfigured: false });
  });

  it("rejects owner credentials and cross-business reader keys before a cron scan", async () => {
    const f = await fixture();
    const writes = vi.spyOn(f.service.store, "write");
    await expect(runCronCollectionsMonitor(f.service, request(f.env.CRON_SECRET), { ...f.env, ARCPAYLINK_COLLECTIONS_READER_KEY: f.created.token })).rejects.toMatchObject({ status: 403 });
    const other = await f.service.createWorkspace({ name: "Other cron business", recipient });
    writes.mockClear();
    await expect(runCronCollectionsMonitor(f.service, request(f.env.CRON_SECRET), { ...f.env, ARCPAYLINK_COLLECTIONS_WORKSPACE_ID: other.workspace.id })).rejects.toMatchObject({ status: 503 });
    expect(writes).not.toHaveBeenCalled();
  });

  it("uses server-selected chain and fixed execution bounds despite query parameters and extra env", async () => {
    const f = await fixture();
    const completed = state(f.owner.workspace.id);
    const scan = vi.spyOn(monitoring, "runCollectionsMonitor").mockResolvedValue({ outcome: "complete", state: completed });
    const req = new Request(`https://example.com/api/business/monitor/cron?chainId=1&workspaceId=${randomUUID()}&maxPages=50000&readerToken=attacker`, {
      headers: { authorization: `Bearer ${f.env.CRON_SECRET}` },
    });
    const started = Date.now();
    const result = await runCronCollectionsMonitor(f.service, req, {
      ...f.env, ARCPAYLINK_MONITOR_MAX_PAGES: "50000", ARCPAYLINK_MONITOR_CHAIN_ID: "1", ARCPAYLINK_MONITOR_DEADLINE_MS: "9999999999999",
    });
    expect(scan).toHaveBeenCalledTimes(1);
    const options = scan.mock.calls[0][1];
    expect(options).toMatchObject({
      readerToken: f.reader.token, workspaceId: f.owner.workspace.id, chainId: ARC_CHAIN_ID,
      maxPages: 5, leaseMs: 120_000,
    });
    expect(options.deadlineMs).toBeGreaterThanOrEqual(started + 20_000);
    expect(options.deadlineMs).toBeLessThanOrEqual(Date.now() + 20_000);
    expect(result).toMatchObject({ outcome: "complete", newReceipts: 1 });
    expect(JSON.stringify(result)).not.toContain(f.reader.token);
    expect(JSON.stringify(result)).not.toContain(f.env.CRON_SECRET!);
  });

  it("allows an owner to refresh only its own workspace with a matching reader key", async () => {
    const f = await fixture();
    const principal = await f.service.authorize(f.reader.token);
    const scan = vi.spyOn(monitoring, "runCollectionsMonitor").mockResolvedValue({ outcome: "complete", state: state(f.owner.workspace.id) });
    await expect(runOwnerMonitorRefresh(f.service, principal, { readerToken: f.reader.token })).rejects.toMatchObject({ status: 403 });
    await expect(runOwnerMonitorRefresh(f.service, f.owner, { readerToken: f.created.token })).rejects.toMatchObject({ status: 403 });
    const other = await f.service.createWorkspace({ name: "Other refresh business", recipient });
    const otherOwner = await f.service.authorize(other.token);
    const otherReader = await f.service.issueReader(otherOwner, "Other reader");
    await expect(runOwnerMonitorRefresh(f.service, f.owner, { readerToken: otherReader.token })).rejects.toMatchObject({ status: 403 });
    expect(scan).not.toHaveBeenCalled();
    await expect(runOwnerMonitorRefresh(f.service, f.owner, { readerToken: f.reader.token, workspaceId: other.workspace.id, chainId: 1 })).rejects.toBeDefined();
    expect(scan).not.toHaveBeenCalled();
    const result = await runOwnerMonitorRefresh(f.service, f.owner, { readerToken: f.reader.token });
    expect(scan.mock.calls[0][1]).toMatchObject({ readerToken: f.reader.token, workspaceId: f.owner.workspace.id, chainId: ARC_CHAIN_ID, maxPages: 5, leaseMs: 120_000 });
    expect(result).toMatchObject({ outcome: "complete", newReceipts: 1 });
    expect(JSON.stringify(result)).not.toContain(f.reader.token);
  });

  it("blocks forged owner key/workspace identity and revoked manual readers", async () => {
    const f = await fixture();
    const scan = vi.spyOn(monitoring, "runCollectionsMonitor");
    const forged = { ...f.owner, key: { ...f.owner.key, merchantId: randomUUID() } };
    await expect(runOwnerMonitorRefresh(f.service, forged, { readerToken: f.reader.token })).rejects.toMatchObject({ status: 403 });
    await f.service.revokeKey(f.owner, f.reader.key.id);
    await expect(runOwnerMonitorRefresh(f.service, f.owner, { readerToken: f.reader.token })).rejects.toMatchObject({ status: 401 });
    expect(scan).not.toHaveBeenCalled();
  });
});
