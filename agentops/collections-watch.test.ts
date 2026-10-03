import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectionOrigin, CollectionsWatchError, loadWatchState, runWatchPass,
  saveWatchState, type CollectionEvent, type WatchState,
} from "./collections-watch";

const origin = "https://arc-paylink.example";
const workspaceId = "621b6ec6-f181-45c7-942e-ab01dddc407f";
const otherId = "fe7a52f8-7c6c-4bd5-bb45-58e47d2e414f";
const token = `apm_${workspaceId}.${otherId}.${"A".repeat(43)}`;
const timestamp = "2026-10-01T18:27:51.221Z";
const event: CollectionEvent = {
  eventId: `604c797f-68d3-40bd-a483-bc7a36e7a33c:0x${"a".repeat(64)}`,
  type: "payment.confirmed",
  order: {
    id: "604c797f-68d3-40bd-a483-bc7a36e7a33c", merchantName: "Internal pilot",
    reference: "PILOT-001", title: "Collection test", amount: "0.01",
    recipient: `0x${"1".repeat(40)}`, chainId: 5042,
    createdAt: timestamp, status: "paid", receipt: {
      transactionHash: `0x${"a".repeat(64)}`, sender: `0x${"2".repeat(40)}`,
      blockNumber: "23751439", confirmedAt: timestamp,
    },
  },
};
const summary = {
  count: 1, paidCount: 1, processing: 0, overdue: 0, paidUsdc: "0.01",
  outstandingUsdc: "0", chainId: 5042, asOf: timestamp,
};
const session = { workspace: { id: workspaceId, chainId: 5042 }, role: "reader" };
const initial = (): WatchState => ({ version: 1, origin, workspaceId, chainId: 5042, events: [] });
function api(pages: unknown[], options?: { session?: unknown; summary?: unknown }) {
  let page = 0;
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const body = url.pathname.endsWith("/session") ? (options?.session ?? session)
      : url.pathname.endsWith("/summary") ? (options?.summary ?? summary)
      : pages[page++];
    return Response.json(body);
  }) as unknown as typeof fetch;
}
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("read-only collections watcher", () => {
  it("captures every page and restarts completed scans without repeating a receipt", async () => {
    const save = vi.fn(async () => undefined);
    const firstApi = api([{ events: [event], cursor: "opaque/page+2" }, { events: [event] }]);
    const first = await runWatchPass({ origin, token, fetch: firstApi, save, now: () => timestamp });
    expect(first.newEvents).toEqual([event]);
    expect(first.state.events).toEqual([event]);
    expect(first.state.cursor).toBeUndefined();
    expect(first.state.summary?.paidUsdc).toBe("0.01");
    expect(String(vi.mocked(firstApi).mock.calls[2][0])).toContain("cursor=opaque%2Fpage%2B2");
    const secondApi = api([{ events: [event] }]);
    const second = await runWatchPass({ origin, token, state: first.state, fetch: secondApi, save });
    expect(second.newEvents).toEqual([]);
    expect(String(vi.mocked(secondApi).mock.calls[1][0])).toBe(`${origin}/api/business/events`);
    for (const [, options] of vi.mocked(firstApi).mock.calls) {
      expect(options?.method).toBe("GET");
      expect(options?.redirect).toBe("error");
      expect(options?.credentials).toBe("omit");
    }
  });

  it("resumes a failed scan from the last atomically saved page", async () => {
    let saved: WatchState | undefined;
    const failing = api([{ events: [event], cursor: "resume-page" }, { invalid: "page" }]);
    await expect(runWatchPass({ origin, token, fetch: failing, save: async state => { saved = state; } }))
      .rejects.toThrow("invalid receipt page");
    expect(saved?.events).toEqual([event]);
    expect(saved?.cursor).toBe("resume-page");
    const resumedApi = api([{ events: [event] }]);
    const resumed = await runWatchPass({ origin, token, state: saved, fetch: resumedApi, save: async () => undefined });
    expect(String(vi.mocked(resumedApi).mock.calls[1][0])).toContain("cursor=resume-page");
    expect(resumed.newEvents).toEqual([]);
  });

  it("refuses owner keys or a checkpoint from a different business before reading receipts", async () => {
    const save = vi.fn(async () => undefined);
    const ownerApi = api([], { session: { ...session, role: "owner" } });
    await expect(runWatchPass({ origin, token, fetch: ownerApi, save })).rejects.toThrow("scoped reader key");
    expect(vi.mocked(ownerApi)).toHaveBeenCalledTimes(1);
    const anotherApi = api([], { session: { workspace: { id: otherId, chainId: 5042 }, role: "reader" } });
    await expect(runWatchPass({ origin, token, state: initial(), fetch: anotherApi, save })).rejects.toThrow("another deployment");
    expect(vi.mocked(anotherApi)).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects malformed identities, wrong-chain receipts and changed proofs", async () => {
    const save = vi.fn(async () => undefined);
    for (const invalid of [
      { ...event, eventId: "invented" },
      { ...event, order: { ...event.order, chainId: 5042002 } },
      { ...event, order: { ...event.order, amount: "0.0000001" } },
    ]) {
      await expect(runWatchPass({ origin, token, fetch: api([{ events: [invalid] }]), save }))
        .rejects.toThrow("invalid receipt page");
    }
    expect(save).not.toHaveBeenCalled();
    const changed = { ...event, order: { ...event.order, amount: "0.02" } };
    await expect(runWatchPass({ origin, token, state: { ...initial(), events: [event] }, fetch: api([{ events: [changed] }]), save }))
      .rejects.toThrow("changed unexpectedly");
  });

  it("detects a pagination loop and retains the completed page", async () => {
    let saved: WatchState | undefined;
    await expect(runWatchPass({ origin, token, fetch: api([
      { events: [event], cursor: "loop" }, { events: [], cursor: "loop" },
    ]), save: async state => { saved = state; } })).rejects.toThrow("repeated a page cursor");
    expect(saved?.cursor).toBe("loop");
    expect(saved?.events).toEqual([event]);
  });

  it("keeps error output free of token and provider response text", async () => {
    const fetch = vi.fn(async () => new Response(`private ${token}`, { status: 401 })) as unknown as typeof globalThis.fetch;
    let error: unknown;
    try { await runWatchPass({ origin, token, fetch, save: async () => undefined }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(CollectionsWatchError);
    expect(String(error)).toContain("HTTP 401");
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain("private");
  });

  it("writes and reloads a private proof ledger without credentials or unrelated fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "collections-watch-"));
    temporary.push(directory);
    const path = join(directory, "receipts.json");
    expect(await loadWatchState(path)).toBeUndefined();
    const polluted = { ...event, secret: token, order: { ...event.order, customerReference: "private customer" } };
    const run = await runWatchPass({ origin, token, fetch: api([{ events: [polluted] }]), save: state => saveWatchState(path, state) });
    expect(await loadWatchState(path)).toEqual(run.state);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const text = await readFile(path, "utf8");
    expect(text).not.toContain(token);
    expect(text).not.toContain("private customer");
    expect(text).not.toContain("secret");
  });

  it("restricts bearer requests to one explicit HTTPS origin", () => {
    expect(collectionOrigin(origin)).toBe(origin);
    expect(collectionOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const invalid of ["http://example.com", "https://key@example.com", `${origin}/api`, `${origin}?key=x`, `${origin}#x`])
      expect(() => collectionOrigin(invalid)).toThrow(CollectionsWatchError);
  });
});
