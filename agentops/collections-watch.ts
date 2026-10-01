import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const uuid = z.string().uuid();
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
const timestamp = z.iso.datetime();
const receipt = z.object({
  transactionHash: hash,
  sender: address,
  blockNumber: z.string().regex(/^\d+$/),
  confirmedAt: timestamp,
});
const eventSchema = z.object({
  eventId: z.string().max(256),
  type: z.literal("payment.confirmed"),
  order: z.object({
    id: uuid,
    merchantName: z.string().max(200),
    reference: z.string().max(200),
    title: z.string().max(500),
    amount,
    recipient: address,
    chainId: z.number().int().positive(),
    createdAt: timestamp,
    dueAt: timestamp.optional(),
    status: z.literal("paid"),
    receipt,
  }),
}).superRefine((event, ctx) => {
  if (event.eventId !== `${event.order.id}:${event.order.receipt.transactionHash.toLowerCase()}`)
    ctx.addIssue({ code: "custom", message: "Receipt event identity mismatch." });
});
const summarySchema = z.object({
  count: z.number().int().nonnegative(),
  paidCount: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  paidUsdc: amount,
  outstandingUsdc: amount,
  chainId: z.number().int().positive(),
  asOf: timestamp,
});
const stateSchema = z.object({
  version: z.literal(1),
  origin: z.string().url(),
  workspaceId: uuid,
  chainId: z.number().int().positive(),
  cursor: z.string().max(2048).optional(),
  events: z.array(eventSchema).max(100_000),
  lastCompleteScanAt: timestamp.optional(),
  summary: summarySchema.optional(),
});
export type CollectionEvent = z.infer<typeof eventSchema>;
export type WatchState = z.infer<typeof stateSchema>;

export class CollectionsWatchError extends Error {}

export function collectionOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new CollectionsWatchError("Set a valid deployment origin."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new CollectionsWatchError("Use an HTTPS deployment origin without credentials, a path or query.");
  return url.origin;
}

function validState(input: unknown): WatchState {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success)
    throw new CollectionsWatchError("Checkpoint is invalid. Preserve it and investigate before restarting.");
  const state = parsed.data;
  if (collectionOrigin(state.origin) !== state.origin ||
      state.events.some(event => event.order.chainId !== state.chainId) ||
      (state.summary && state.summary.chainId !== state.chainId) ||
      new Set(state.events.map(event => event.eventId)).size !== state.events.length)
    throw new CollectionsWatchError("Checkpoint identity or event ledger is invalid.");
  return state;
}

export async function loadWatchState(path: string): Promise<WatchState | undefined> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CollectionsWatchError("Unable to read checkpoint.");
  }
  try { return validState(JSON.parse(text)); }
  catch (error) {
    if (error instanceof CollectionsWatchError) throw error;
    throw new CollectionsWatchError("Checkpoint is not valid JSON. Preserve it before restarting.");
  }
}

// A saved ledger is the durable output. Stdout is a convenience notification;
// downstream consumers also deduplicate by eventId when replaying this ledger.
export async function saveWatchState(path: string, state: WatchState) {
  const validated = validState(state);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

type WatchOptions = {
  origin: string;
  token: string;
  state?: WatchState;
  save: (state: WatchState) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  maxPages?: number;
};

export async function runWatchPass(options: WatchOptions) {
  const origin = collectionOrigin(options.origin);
  const token = options.token;
  if (!/^apm_[0-9a-f-]+\.[0-9a-f-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    throw new CollectionsWatchError("Set a valid read-only business key in ARCPAYLINK_COLLECTIONS_KEY.");
  const request = options.fetch ?? globalThis.fetch;
  const get = async (path: string) => {
    let response: Response;
    try {
      response = await request(`${origin}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CollectionsWatchError("Collection API request failed; checkpoint was retained.");
    }
    if (!response.ok)
      throw new CollectionsWatchError(`Collection API returned HTTP ${response.status}; checkpoint was retained.`);
    try { return await response.json(); }
    catch { throw new CollectionsWatchError("Collection API returned invalid JSON; checkpoint was retained."); }
  };
  const session = z.object({
    workspace: z.object({ id: uuid, chainId: z.number().int().positive() }),
    role: z.literal("reader"),
  }).safeParse(await get("/api/business/session"));
  if (!session.success)
    throw new CollectionsWatchError("Watcher requires a scoped reader key and a valid business session.");
  const workspace = session.data.workspace;
  let state: WatchState = options.state ? validState(options.state) : {
    version: 1, origin, workspaceId: workspace.id, chainId: workspace.chainId, events: [],
  };
  if (state.origin !== origin || state.workspaceId !== workspace.id || state.chainId !== workspace.chainId)
    throw new CollectionsWatchError("Checkpoint belongs to another deployment, business or chain. Use a separate checkpoint.");
  const seen = new Map(state.events.map(event => [event.eventId, event]));
  const newEvents: CollectionEvent[] = [];
  const cursors = new Set<string>();
  if (state.cursor) cursors.add(state.cursor);
  const maxPages = options.maxPages ?? 1000;
  for (let pageNumber = 0; ; pageNumber++) {
    if (pageNumber >= maxPages)
      throw new CollectionsWatchError("Scan page limit reached; resume from the saved checkpoint.");
    const path = `/api/business/events${state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : ""}`;
    const page = z.object({
      events: z.array(eventSchema).max(100),
      cursor: z.string().max(2048).optional(),
    }).safeParse(await get(path));
    if (!page.success || page.data.events.some(event => event.order.chainId !== workspace.chainId))
      throw new CollectionsWatchError("Collection API returned an invalid receipt page; checkpoint was retained.");
    const nextCursor = page.data.cursor || undefined;
    if (nextCursor && cursors.has(nextCursor))
      throw new CollectionsWatchError("Collection API repeated a page cursor; checkpoint was retained.");
    for (const event of page.data.events) {
      const prior = seen.get(event.eventId);
      // A proof identity is immutable. Do not replace a previously saved proof.
      if (prior && (JSON.stringify(prior.order.receipt) !== JSON.stringify(event.order.receipt) ||
          prior.order.amount !== event.order.amount ||
          prior.order.recipient.toLowerCase() !== event.order.recipient.toLowerCase()))
        throw new CollectionsWatchError("A saved receipt changed unexpectedly; checkpoint was retained.");
      if (!prior) {
        seen.set(event.eventId, event);
        newEvents.push(event);
      }
    }
    if (seen.size > 100_000)
      throw new CollectionsWatchError("Receipt ledger limit reached; archive it before adding more receipts.");
    state = {
      ...state, cursor: nextCursor, events: [...seen.values()],
      ...(nextCursor ? {} : { lastCompleteScanAt: (options.now ?? (() => new Date().toISOString()))() }),
    };
    await options.save(state);
    if (!nextCursor) break;
    cursors.add(nextCursor);
  }
  const summary = summarySchema.safeParse(await get("/api/business/summary"));
  if (!summary.success || summary.data.chainId !== workspace.chainId)
    throw new CollectionsWatchError("Collection API returned an invalid summary; receipt ledger was retained.");
  state = { ...state, summary: summary.data };
  await options.save(state);
  return { state, newEvents };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg, index) => arg !== "--once" && arg !== "--state" && args[index - 1] !== "--state"))
    throw new CollectionsWatchError("Usage: node --import tsx agentops/collections-watch.ts [--once] [--state PATH]");
  const pathIndex = args.indexOf("--state");
  if (pathIndex >= 0 && (!args[pathIndex + 1] || args[pathIndex + 1].startsWith("--")))
    throw new CollectionsWatchError("Provide a checkpoint path after --state.");
  const statePath = resolve(pathIndex >= 0 ? args[pathIndex + 1] : ".arcpaylink-collections/receipts.json");
  const origin = collectionOrigin(process.env.ARCPAYLINK_COLLECTIONS_URL ?? "");
  const token = process.env.ARCPAYLINK_COLLECTIONS_KEY ?? "";
  const seconds = Number(process.env.ARCPAYLINK_COLLECTIONS_INTERVAL_SECONDS ?? 60);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 86400)
    throw new CollectionsWatchError("Polling interval must be between 30 and 86400 seconds.");
  await mkdir(dirname(statePath), { recursive: true });
  let lock;
  try { lock = await open(`${statePath}.lock`, "wx", 0o600); }
  catch { throw new CollectionsWatchError("Checkpoint is locked. Stop the other watcher before removing a stale lock."); }
  await lock.writeFile(`${process.pid}\n`);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    let state = await loadWatchState(statePath);
    while (!abort.signal.aborted) {
      const result = await runWatchPass({
        origin, token, state, save: value => saveWatchState(statePath, value),
      });
      state = result.state;
      process.stdout.write(`${JSON.stringify({
        mode: "READ_ONLY_COLLECTIONS_WATCH", workspaceId: state.workspaceId,
        chainId: state.chainId, newEvents: result.newEvents, trackedReceipts: state.events.length,
        summary: state.summary, checkpoint: statePath,
      })}\n`);
      if (args.includes("--once")) break;
      try { await delay(seconds * 1000, undefined, { signal: abort.signal }); }
      catch { if (!abort.signal.aborted) throw new CollectionsWatchError("Watcher delay failed."); }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await lock.close();
    await unlink(`${statePath}.lock`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Do not forward provider errors, request objects, environment keys or tokens.
    process.stderr.write(`${error instanceof CollectionsWatchError ? error.message : "Watcher failed; preserve the checkpoint and investigate."}\n`);
    process.exitCode = 1;
  });
}
