import { createHash, randomUUID } from "node:crypto";
import { formatUnits } from "viem";
import { z } from "zod";
import { parseUsdcAmount } from "../amount";
import { ARC_CHAIN_ID } from "../arc";
import { CommerceService, uuid } from "./service";
import { CommerceError, type Versioned } from "./store";
import type { Principal } from "./types";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const iso = z.iso.datetime({ offset: true });
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const units = z.string().regex(/^\d+$/);
const usdc = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
const eventSchema = z.object({
  eventId: z.string().max(256),
  type: z.literal("payment.confirmed"),
  order: z.object({
    id: uuid, merchantName: z.string().max(200), reference: z.string().max(200),
    title: z.string().max(500), amount: usdc, recipient: address,
    chainId: z.number().int().positive(), createdAt: iso, dueAt: iso.optional(),
    status: z.literal("paid"),
    receipt: z.object({ transactionHash: hash, sender: address, blockNumber: units, confirmedAt: iso }),
  }),
}).refine(event => event.eventId === `${event.order.id}:${event.order.receipt.transactionHash.toLowerCase()}`);
type MonitorEvent = z.infer<typeof eventSchema>;
const summarySchema = z.object({
  count: integer, paidCount: integer, processing: integer, overdue: integer,
  paidUsdc: usdc, outstandingUsdc: usdc, chainId: z.number().int().positive(), asOf: iso,
});
const aggregateSchema = z.object({
  cursor: z.string().max(2048).optional(), count: integer, paidCount: integer,
  processing: integer, overdue: integer, paidUnits: units, outstandingUnits: units,
});
const pendingSchema = z.object({
  cursor: z.string().max(2048).optional(),
  nextCursor: z.string().max(2048).optional(),
  events: z.array(eventSchema).max(100),
  newEventIds: z.array(z.string().max(256)).max(100),
});
const stateSchema = z.object({
  version: z.literal(1), workspaceId: uuid, chainId: z.number().int().positive(),
  phase: z.enum(["events", "summary"]), cursor: z.string().max(2048).optional(),
  trackedReceiptCount: integer, completedScans: integer,
  lastReceiptScanAt: iso.optional(), lastSuccessfulAt: iso.optional(),
  lastCronSuccessfulAt: iso.optional(),
  summary: summarySchema.optional(), aggregate: aggregateSchema.optional(),
  pending: pendingSchema.optional(),
  lease: z.object({ id: uuid, expiresAt: integer }).optional(),
  lastRun: z.object({
    id: uuid, startedAt: iso, finishedAt: iso.optional(),
    outcome: z.enum(["running", "complete", "partial", "failed"]),
    trigger: z.enum(["owner", "cron"]).optional(),
    pages: integer, newReceipts: integer,
    failure: z.literal("monitor_operation_failed").optional(),
  }).optional(),
});

export type CollectionsMonitorState = z.infer<typeof stateSchema>;
export type CollectionsMonitorOptions = {
  readerToken: string;
  workspaceId: string;
  chainId: number;
  /** Combined receipt and order pages per invocation; default 5, maximum 50. */
  maxPages?: number;
  /** Absolute epoch-millisecond deadline; defaults to now + 20 seconds. */
  deadlineMs?: number;
  /** Lease duration, default 120 seconds. No filesystem lock is used. */
  leaseMs?: number;
  now?: () => number;
  runId?: string;
  trigger?: "owner" | "cron";
};
export type CollectionsMonitorResult = {
  outcome: "complete" | "partial" | "busy";
  state: CollectionsMonitorState;
};
type StoredEvent = { version: 1; workspaceId: string; chainId: number; proof: string; event: MonitorEvent };
class MonitorDeadlineReached extends Error {}

export const monitorPath = (workspaceId: string) =>
  `merchants/${uuid.parse(workspaceId)}/monitor/state.json`;
const eventPath = (workspaceId: string, eventId: string) =>
  `merchants/${uuid.parse(workspaceId)}/monitor/events/${createHash("sha256").update(eventId).digest("hex")}.json`;
const blankAggregate = () => ({ count: 0, paidCount: 0, processing: 0, overdue: 0, paidUnits: "0", outstandingUnits: "0" });
const proofOf = (event: MonitorEvent) => createHash("sha256").update(JSON.stringify({
  eventId: event.eventId, chainId: event.order.chainId,
  amount: formatUnits(parseUsdcAmount(event.order.amount), 6),
  recipient: event.order.recipient.toLowerCase(),
  receipt: { ...event.order.receipt, transactionHash: event.order.receipt.transactionHash.toLowerCase(), sender: event.order.receipt.sender.toLowerCase() },
})).digest("hex");

function parseState(input: unknown, workspaceId: string, chainId: number) {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success || parsed.data.workspaceId !== workspaceId || parsed.data.chainId !== chainId)
    throw new CommerceError("Collection monitor checkpoint identity is invalid.", 409);
  const state = parsed.data;
  if ((state.summary && state.summary.chainId !== chainId) ||
      (state.phase === "summary" && (!state.aggregate || state.pending)) ||
      (state.phase === "events" && state.aggregate) ||
      (state.pending && (state.pending.cursor !== state.cursor ||
        state.pending.events.some(event => event.order.chainId !== chainId) ||
        new Set(state.pending.events.map(event => event.eventId)).size !== state.pending.events.length ||
        new Set(state.pending.newEventIds).size !== state.pending.newEventIds.length ||
        state.pending.newEventIds.some(id => !state.pending!.events.some(event => event.eventId === id)))))
    throw new CommerceError("Collection monitor checkpoint content is invalid.", 409);
  return state;
}

function readerIdentity(principal: Principal, workspaceId: string, chainId: number) {
  if (principal.key.role !== "reader")
    throw new CommerceError("Collection monitor requires a read-only agent key.", 403);
  if (principal.workspace.id !== workspaceId || principal.workspace.chainId !== chainId || principal.key.merchantId !== workspaceId)
    throw new CommerceError("Collection monitor key does not match its configured business and chain.", 403);
}

export async function readCollectionsMonitor(service: CommerceService, principal: Principal) {
  // Callers authorize the key before creating this principal. Reading a report
  // is available to its owner too; running the monitor remains reader-only.
  if ((principal.key.role !== "owner" && principal.key.role !== "reader") ||
      principal.key.revokedAt || !uuid.safeParse(principal.workspace.id).success ||
      principal.key.merchantId !== principal.workspace.id || principal.workspace.chainId !== ARC_CHAIN_ID)
    throw new CommerceError("Collection monitor report access is invalid.", 403);
  const saved = await service.store.read<unknown>(monitorPath(principal.workspace.id));
  return saved ? parseState(saved.value, principal.workspace.id, principal.workspace.chainId) : undefined;
}

/**
 * Read-only business monitoring, with writes restricted to /monitor/ records.
 * One compact ETag checkpoint contains the lease, pending-page write-ahead log,
 * cursor and counts. Each proof has an immutable separate ledger record. A crash
 * after a ledger append is repaired from pending before counts/cursor advance.
 * Old runners may only encounter the same immutable append; they cannot commit
 * or release a successor's checkpoint because both lease ID and ETag fence it.
 * Receipt/order pages are bounded at 100 by CommerceStore. Summary scanning is
 * capped at 10,000 orders, matching CommerceService.summary. Reports are scans,
 * not multi-object snapshots; a following scan catches concurrently new records.
 */
export async function runCollectionsMonitor(
  service: CommerceService,
  options: CollectionsMonitorOptions,
): Promise<CollectionsMonitorResult> {
  uuid.parse(options.workspaceId);
  const now = options.now ?? Date.now;
  const runId = options.runId ?? randomUUID();
  uuid.parse(runId);
  const start = now();
  const deadline = options.deadlineMs ?? start + 20_000;
  const leaseMs = options.leaseMs ?? 120_000;
  const maxPages = options.maxPages ?? 5;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50 ||
      !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000 ||
      !Number.isSafeInteger(deadline) || deadline <= start ||
      !Number.isInteger(options.chainId) || options.chainId <= 0)
    throw new CommerceError("Invalid collection monitor execution limits.");
  const authorize = async () => {
    const principal = await service.authorize(options.readerToken);
    readerIdentity(principal, options.workspaceId, options.chainId);
    return principal;
  };
  await authorize();
  const path = monitorPath(options.workspaceId);
  let saved = await service.store.read<unknown>(path);
  let state: CollectionsMonitorState = saved ? parseState(saved.value, options.workspaceId, options.chainId) : {
    version: 1, workspaceId: options.workspaceId, chainId: options.chainId,
    phase: "events", trackedReceiptCount: 0, completedScans: 0,
  };
  if (state.lease && state.lease.expiresAt > now()) return { outcome: "busy", state };
  state = { ...state, lease: { id: runId, expiresAt: now() + leaseMs },
    lastRun: { id: runId, startedAt: new Date(start).toISOString(), outcome: "running", trigger: options.trigger, pages: 0, newReceipts: 0 } };
  await authorize();
  try { await service.store.write(path, state, saved?.version); }
  catch (error) {
    if (!(error instanceof CommerceError) || error.status !== 409) throw error;
    const competing = await service.store.read<unknown>(path);
    if (!competing) throw error;
    const current = parseState(competing.value, options.workspaceId, options.chainId);
    if (current.lease && current.lease.expiresAt > now()) return { outcome: "busy", state: current };
    throw error;
  }
  const reload = async (): Promise<Versioned<CollectionsMonitorState>> => {
    const current = await service.store.read<unknown>(path);
    if (!current) throw new CommerceError("Collection monitor lease is unavailable.", 409);
    const parsed = parseState(current.value, options.workspaceId, options.chainId);
    if (parsed.lease?.id !== runId || parsed.lease.expiresAt <= now())
      throw new CommerceError("Collection monitor lease expired or changed.", 409);
    return { value: parsed, version: current.version };
  };
  saved = await reload();
  state = saved.value as CollectionsMonitorState;
  const checkpoint = async (next: CollectionsMonitorState, release = false) => {
    const current = await reload();
    if (current.version !== saved!.version)
      throw new CommerceError("Collection monitor checkpoint changed.", 409);
    await authorize();
    if (current.value.lease!.expiresAt <= now())
      throw new CommerceError("Collection monitor lease expired or changed.", 409);
    // Final status/release is cleanup. Ordinary progress writes stop after the
    // deadline; an already-appended pending page is repaired by the next run.
    if (!release && now() >= deadline) throw new MonitorDeadlineReached();
    const value = parseState({ ...next, lease: release ? undefined : { id: runId, expiresAt: now() + leaseMs } }, options.workspaceId, options.chainId);
    await service.store.write(path, value, current.version);
    if (release) { state = value; return; }
    saved = await reload();
    state = saved.value as CollectionsMonitorState;
  };
  const ensureEvent = async (event: MonitorEvent, create: boolean) => {
    await authorize();
    await reload();
    const recordPath = eventPath(options.workspaceId, event.eventId);
    const existing = await service.store.read<StoredEvent>(recordPath);
    const expected: StoredEvent = { version: 1, workspaceId: options.workspaceId, chainId: options.chainId, proof: proofOf(event), event };
    const matches = (record: StoredEvent) => record.version === 1 && record.workspaceId === options.workspaceId && record.chainId === options.chainId && record.proof === expected.proof && proofOf(eventSchema.parse(record.event)) === expected.proof;
    if (existing) {
      if (!matches(existing.value)) throw new CommerceError("Collection monitor detected a conflicting receipt proof.", 409);
      return false;
    }
    if (!create) return true;
    await authorize();
    const active = await reload();
    if (active.value.lease!.expiresAt <= now())
      throw new CommerceError("Collection monitor lease expired or changed.", 409);
    if (now() >= deadline) throw new MonitorDeadlineReached();
    try { await service.store.write(recordPath, expected); }
    catch (error) {
      const raced = await service.store.read<StoredEvent>(recordPath);
      if (!raced || !matches(raced.value)) throw error;
    }
    return true;
  };
  let pages = 0;
  const finish = async (outcome: "complete" | "partial") => {
    const at = new Date(now()).toISOString();
    await checkpoint({ ...state,
      ...(outcome === "complete" ? { lastSuccessfulAt: at, completedScans: state.completedScans + 1,
        ...(options.trigger === "cron" ? { lastCronSuccessfulAt: at } : {}) } : {}),
      lastRun: { ...state.lastRun!, finishedAt: at, outcome },
    }, true);
    return { outcome, state };
  };
  try {
    while (pages < maxPages && now() < deadline) {
      const principal = await authorize();
      await reload();
      if (state.phase === "events") {
        if (!state.pending) {
          const response = await service.events(principal, state.cursor);
          const parsed = z.object({ events: z.array(eventSchema).max(100), cursor: z.string().max(2048).optional() }).safeParse(response);
          if (!parsed.success || parsed.data.events.some(event => event.order.chainId !== options.chainId || event.order.recipient.toLowerCase() !== principal.workspace.recipient.toLowerCase()) ||
              (parsed.data.cursor && parsed.data.cursor === state.cursor))
            throw new CommerceError("Collection monitor received an invalid receipt page.", 409);
          const events = [...new Map(parsed.data.events.map(event => [event.eventId, event])).values()];
          if (events.length !== parsed.data.events.length)
            throw new CommerceError("Collection monitor received duplicate page identities.", 409);
          const newEventIds: string[] = [];
          for (const event of events) {
            if (now() >= deadline) return finish("partial");
            if (await ensureEvent(event, false)) newEventIds.push(event.eventId);
          }
          await checkpoint({ ...state, pending: { cursor: state.cursor, nextCursor: parsed.data.cursor || undefined, events, newEventIds } });
        }
        const pending = state.pending!;
        if (pending.events.some(event => event.order.recipient.toLowerCase() !== principal.workspace.recipient.toLowerCase()))
          throw new CommerceError("Collection monitor receipt recipient is invalid.", 409);
        for (const event of pending.events) {
          if (now() >= deadline) return finish("partial");
          await ensureEvent(event, true);
        }
        await checkpoint({ ...state, pending: undefined, cursor: pending.nextCursor,
          trackedReceiptCount: state.trackedReceiptCount + pending.newEventIds.length,
          ...(pending.nextCursor ? {} : { phase: "summary", aggregate: blankAggregate(), lastReceiptScanAt: new Date(now()).toISOString() }),
          lastRun: { ...state.lastRun!, pages: state.lastRun!.pages + 1, newReceipts: state.lastRun!.newReceipts + pending.newEventIds.length },
        });
      } else {
        const aggregate = state.aggregate!;
        const page = await service.listOrders(principal, aggregate.cursor);
        if (page.orders.length > 100 || (page.cursor && page.cursor === aggregate.cursor))
          throw new CommerceError("Collection monitor received an invalid order page.", 409);
        const next = { ...aggregate, cursor: page.cursor || undefined };
        for (const order of page.orders) {
          if (order.merchantId !== options.workspaceId || order.chainId !== options.chainId)
            throw new CommerceError("Collection monitor order identity is invalid.", 409);
          next.count++;
          if (order.status === "paid") {
            next.paidCount++;
            next.paidUnits = String(BigInt(next.paidUnits) + parseUsdcAmount(order.amount));
          }
          if (order.status === "pending" || order.status === "processing") {
            next.outstandingUnits = String(BigInt(next.outstandingUnits) + parseUsdcAmount(order.amount));
            if (order.dueAt && Date.parse(order.dueAt) < now()) next.overdue++;
          }
          if (order.status === "processing") next.processing++;
        }
        if (next.count > 10_000 || (next.count === 10_000 && next.cursor))
          throw new CommerceError("Collection monitor summary exceeds 10,000 orders; use paginated reporting.", 422);
        await checkpoint({ ...state,
          ...(next.cursor ? { aggregate: next } : {
            phase: "events", cursor: undefined, aggregate: undefined,
            summary: { count: next.count, paidCount: next.paidCount, processing: next.processing, overdue: next.overdue,
              paidUsdc: formatUnits(BigInt(next.paidUnits), 6), outstandingUsdc: formatUnits(BigInt(next.outstandingUnits), 6),
              chainId: options.chainId, asOf: new Date(now()).toISOString() },
          }),
          lastRun: { ...state.lastRun!, pages: state.lastRun!.pages + 1 },
        });
        if (!next.cursor) return finish("complete");
      }
      pages++;
    }
    return finish("partial");
  } catch (error) {
    if (error instanceof MonitorDeadlineReached) return finish("partial");
    try {
      await checkpoint({ ...state, lastRun: { ...state.lastRun!, finishedAt: new Date(now()).toISOString(), outcome: "failed", failure: "monitor_operation_failed" } }, true);
    } catch { /* An expired/replaced/revoked lease must not be released by this runner. */ }
    throw error;
  }
}
