import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceService } from "./service";
import { MemoryStore } from "./test-store";
import { IS_ARC_MAINNET } from "../arc";

const context = vi.hoisted(() => ({
  service: undefined as CommerceService | undefined,
  store: undefined as MemoryStore | undefined,
}));
vi.mock("./http", async (original) => ({
  ...(await original<typeof import("./http")>()),
  commerce: () => context.service!,
}));
import { POST } from "../../app/api/checkout/webhooks/circle/route";

const keyId = randomUUID();
const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const key = {
  id: keyId,
  algorithm: "ECDSA_SHA_256",
  publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
};
function signedRequest(raw: string, signedRaw = raw) {
  return new Request("https://example.com/api/checkout/webhooks/circle", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Circle-Key-Id": keyId,
      "X-Circle-Signature": sign("SHA256", Buffer.from(signedRaw), privateKey).toString("base64"),
    },
    body: raw,
  });
}
function publicKeyFetch(response = Response.json({ data: key })) {
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => {
  context.store = new MemoryStore();
  context.service = new CommerceService(context.store);
  vi.stubEnv("CIRCLE_API_KEY", "unit-test-api-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("signed Circle webhook HTTP route", () => {
  it("acknowledges a signed test with 200 and fetches the documented signing key using GET", async () => {
    const fetcher = publicKeyFetch();
    const response = await POST(signedRequest('{ "notificationType": "webhooks.test" }'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`https://api.circle.com/v2/notifications/publicKey/${keyId}`);
    expect(options).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer unit-test-api-key" },
    });
    expect(options.body).toBeUndefined();
    expect(options.headers["X-User-Token"]).toBeUndefined();
  });
  it("rejects an unsigned request before any provider call", async () => {
    const fetcher = publicKeyFetch();
    const response = await POST(new Request("https://example.com/api/checkout/webhooks/circle", {
      method: "POST",
      body: '{"notificationType":"webhooks.test"}',
    }));
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects changed raw bytes even when the JSON means the same thing", async () => {
    publicKeyFetch();
    const raw = '{ "notificationType": "webhooks.test" }';
    const response = await POST(signedRequest(`${raw} `, raw));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid Circle signature." });
  });
  it.each([403, 404])("does not acknowledge or record a notification when the signing-key API returns %s, and hides its body", async (status) => {
    publicKeyFetch(Response.json({ message: "private-provider-response", token: "provider-secret" }, { status }));
    const response = await POST(signedRequest('{"notificationType":"webhooks.test"}'));
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain(`Circle could not complete the request (${status})`);
    expect(body).not.toContain("private-provider-response");
    expect(body).not.toContain("provider-secret");
    expect(body).not.toContain("unit-test-api-key");
    expect(context.store!.data.size).toBe(0);
  });
  it("does not acknowledge a signed notification when the signing-key service is unavailable", async () => {
    publicKeyFetch(Response.json({ message: "temporary provider failure" }, { status: 503 }));
    const response = await POST(signedRequest('{"notificationType":"webhooks.test"}'));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(context.store!.data.size).toBe(0);
    expect(await response.text()).not.toContain("temporary provider failure");
  });
  it("fails closed without configured Circle credentials instead of trusting a test payload", async () => {
    vi.stubEnv("CIRCLE_API_KEY", "");
    const fetcher = publicKeyFetch();
    const response = await POST(signedRequest('{"notificationType":"webhooks.test"}'));
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect(context.store!.data.size).toBe(0);
  });
  it("does not accept a valid signature under metadata for a different key ID", async () => {
    publicKeyFetch(Response.json({ data: { ...key, id: randomUUID() } }));
    expect((await POST(signedRequest('{"notificationType":"webhooks.test"}'))).status).toBe(401);
  });
  it("rejects an unsupported signing algorithm without treating the notification as a test bypass", async () => {
    publicKeyFetch(Response.json({ data: { ...key, algorithm: "none" } }));
    expect((await POST(signedRequest('{"notificationType":"webhooks.test"}'))).status).toBe(401);
  });
  it("acknowledges a signed outbound sample with no owned order instead of inventing a payment", async () => {
    publicKeyFetch();
    const txId = randomUUID();
    const read = vi.spyOn(context.store!, "read");
    const response = await POST(signedRequest(JSON.stringify({
      notificationId: randomUUID(),
      notificationType: "transactions.outbound",
      notification: {
        id: txId,
        walletId: randomUUID(),
        blockchain: process.env.CIRCLE_ARC_BLOCKCHAIN || (IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET"),
        state: "COMPLETE",
        txHash: `0x${"a".repeat(64)}`,
      },
    })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: true });
    expect(read).toHaveBeenCalledWith(`circle-transactions/${txId}.json`);
    expect(context.store!.data.size).toBe(0);
  });
});
