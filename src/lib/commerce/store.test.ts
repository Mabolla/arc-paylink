import { afterEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn(), put: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => sdk);
import { blobCommerceStore, root } from "./store";

function response(value: unknown, etag: string) {
  return { statusCode: 200, stream: new Response(JSON.stringify(value)).body, blob: { etag } };
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
function store() { vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-private-token"); return blobCommerceStore(); }

describe("private Blob conditional record versions", () => {
  it("uses an uncached body and its strong version without extra metadata reads", async () => {
    sdk.get.mockResolvedValue(response({ count: 1 }, '"version-1"'));
    const s = store();
    const saved = await s.read("monitor.json");
    expect(saved).toEqual({ value: { count: 1 }, version: '"version-1"' });
    expect(sdk.get).toHaveBeenCalledWith(root + "monitor.json", expect.objectContaining({ access: "private", useCache: false, headers: { "Accept-Encoding": "identity" } }));
    expect(sdk.head).not.toHaveBeenCalled();
    await s.write("monitor.json", { count: 2 }, saved!.version);
    expect(sdk.put).toHaveBeenCalledWith(root + "monitor.json", '{"count":2}', expect.objectContaining({ allowOverwrite: true, ifMatch: '"version-1"' }));
  });

  it("uses authoritative matching metadata for a transformed weak HTTP version", async () => {
    sdk.get.mockResolvedValue(response({ count: 1 }, 'W/"version-1"'));
    sdk.head.mockResolvedValue({ etag: '"version-1"' });
    const s = store();
    const saved = await s.read("monitor.json");
    expect(saved!.version).toBe('"version-1"');
    await s.write("monitor.json", { count: 2 }, saved!.version);
    expect(sdk.put.mock.calls[0][2].ifMatch).toBe('"version-1"');
    expect(sdk.head).toHaveBeenCalledTimes(1);
  });

  it("binds unrelated or missing content tags to a fresh body between stable authoritative versions", async () => {
    sdk.get.mockResolvedValueOnce(response({ count: 1 }, ""))
      .mockResolvedValueOnce(response({ count: 2 }, 'W/"http-transform-tag"'));
    sdk.head.mockResolvedValue({ etag: '"object-version-2"' });
    const saved = await store().read("monitor.json");
    expect(saved).toEqual({ value: { count: 2 }, version: '"object-version-2"' });
    expect(sdk.get).toHaveBeenCalledTimes(2);
    expect(sdk.head).toHaveBeenCalledTimes(2);
  });

  it("rejects a metadata change across the fallback body read without any write", async () => {
    sdk.get.mockResolvedValueOnce(response({ count: 1 }, 'W/"http-tag"'))
      .mockResolvedValueOnce(response({ count: 2 }, 'W/"http-tag-2"'));
    sdk.head.mockResolvedValueOnce({ etag: '"before"' }).mockResolvedValueOnce({ etag: '"after"' });
    await expect(store().read("monitor.json")).rejects.toMatchObject({ status: 409 });
    expect(sdk.put).not.toHaveBeenCalled();
  });

  it("fails closed for missing authoritative versions and never passes a weak update version to put", async () => {
    sdk.get.mockResolvedValue(response({ count: 1 }, 'W/"http-tag"'));
    sdk.head.mockResolvedValue({ etag: "" });
    const s = store();
    await expect(s.read("monitor.json")).rejects.toMatchObject({ status: 503 });
    await expect(s.write("monitor.json", {}, 'W/"weak"')).rejects.toMatchObject({ status: 503 });
    await expect(s.write("monitor.json", {}, "")).rejects.toMatchObject({ status: 503 });
    expect(sdk.put).not.toHaveBeenCalled();
  });

  it("keeps creation non-overwriting and conditional conflicts visible", async () => {
    const s = store();
    await s.write("new.json", {});
    expect(sdk.put.mock.calls[0][2]).toMatchObject({ allowOverwrite: false });
    expect(sdk.put.mock.calls[0][2]).not.toHaveProperty("ifMatch");
    sdk.put.mockRejectedValue(new Error("Precondition failed"));
    await expect(s.write("monitor.json", {}, '"version-1"')).rejects.toMatchObject({ status: 409 });
  });
});
