import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ARC_CHAIN_ID } from "../arc";
import { readCollectionsMonitor, runCollectionsMonitor, type CollectionsMonitorState } from "./monitor";
import { CommerceService, uuid } from "./service";
import { CommerceError } from "./store";
import type { Principal } from "./types";

type CronMonitorConfig = { secret: string; readerToken: string; workspaceId: string; chainId: number };
const readerKey = /^apm_([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
const configurationError = () => new CommerceError("Automatic collection checks are not configured.", 503);

/** Server-only configuration. Never return this object from an endpoint. */
export function cronMonitorConfig(env: NodeJS.ProcessEnv = process.env): CronMonitorConfig {
  const secret = env.CRON_SECRET ?? "";
  const readerToken = env.ARCPAYLINK_COLLECTIONS_READER_KEY ?? "";
  const workspaceId = env.ARCPAYLINK_COLLECTIONS_WORKSPACE_ID ?? "";
  const identity = readerToken.match(readerKey);
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret) || !identity ||
      !uuid.safeParse(workspaceId).success || !uuid.safeParse(identity[2]).success || identity[1] !== workspaceId ||
      Object.entries(env).some(([name, value]) => name !== "CRON_SECRET" &&
        /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && value === secret)) throw configurationError();
  return { secret, readerToken, workspaceId, chainId: ARC_CHAIN_ID };
}

export function authorizeCronRequest(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const config = cronMonitorConfig(env);
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (authorization !== `Bearer ${presented}` || !presented ||
      !timingSafeEqual(digest(presented), digest(config.secret)))
    throw new CommerceError("Unauthorized collection check.", 401);
  return config;
}

/** Explicit public allowlist: no credentials, cursors, lease IDs or pending receipt data. */
export function monitorReport(state: CollectionsMonitorState | undefined, now = Date.now()) {
  if (!state) return null;
  const last = state.lastRun;
  const outcome = last?.outcome === "running"
    ? state.lease && state.lease.expiresAt > now ? "busy" : "partial"
    : last?.outcome ?? "never";
  return {
    outcome,
    chainId: state.chainId,
    trackedReceipts: state.trackedReceiptCount,
    completedScans: state.completedScans,
    ...(state.lastSuccessfulAt ? { lastCompletedAt: state.lastSuccessfulAt } : {}),
    ...(last ? { lastStartedAt: last.startedAt, newReceipts: last.newReceipts } : {}),
    ...(state.summary ? {
      summaryAsOf: state.summary.asOf,
      paidUsdc: state.summary.paidUsdc,
      outstandingUsdc: state.summary.outstandingUsdc,
      orders: state.summary.count,
      paidOrders: state.summary.paidCount,
      processingOrders: state.summary.processing,
      overdueOrders: state.summary.overdue,
    } : {}),
  };
}

function sameBusiness(principal: Principal, workspaceId: string) {
  if (principal.workspace.id !== workspaceId || principal.key.merchantId !== workspaceId ||
      principal.workspace.chainId !== ARC_CHAIN_ID)
    throw new CommerceError("Collection key does not match this business and chain.", 403);
}

export async function monitorStatus(service: CommerceService, principal: Principal, env: NodeJS.ProcessEnv = process.env) {
  sameBusiness(principal, principal.workspace.id);
  const monitor = monitorReport(await readCollectionsMonitor(service, principal));
  let schedulingConfigured = false;
  try {
    const config = cronMonitorConfig(env);
    sameBusiness(principal, config.workspaceId);
    const reader = await service.authorize(config.readerToken);
    sameBusiness(reader, config.workspaceId);
    schedulingConfigured = reader.key.role === "reader";
  } catch { /* Missing, revoked or other-business configuration does not activate a schedule. */ }
  return { monitor, schedulingConfigured };
}

async function execute(service: CommerceService, readerToken: string, workspaceId: string) {
  const result = await runCollectionsMonitor(service, {
    readerToken, workspaceId, chainId: ARC_CHAIN_ID,
    maxPages: 5, deadlineMs: Date.now() + 45_000, leaseMs: 120_000,
  });
  return {
    outcome: result.outcome,
    newReceipts: result.outcome === "busy" ? 0 : result.state.lastRun?.newReceipts ?? 0,
    monitor: monitorReport(result.state),
  };
}

/** Owner-triggered one-shot acceptance/refresh, using an ephemeral scoped reader. */
export async function runOwnerMonitorRefresh(service: CommerceService, owner: Principal, body: unknown) {
  service.owner(owner);
  sameBusiness(owner, owner.workspace.id);
  const input = z.object({ readerToken: z.string().min(1).max(256) }).strict().parse(body);
  const reader = await service.authorize(input.readerToken);
  sameBusiness(reader, owner.workspace.id);
  if (reader.key.role !== "reader")
    throw new CommerceError("Collection monitor requires a read-only agent key.", 403);
  return execute(service, input.readerToken, owner.workspace.id);
}

export async function runCronCollectionsMonitor(service: CommerceService, request: Request, env: NodeJS.ProcessEnv = process.env) {
  const config = authorizeCronRequest(request, env);
  return execute(service, config.readerToken, config.workspaceId);
}
