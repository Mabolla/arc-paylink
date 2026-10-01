import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceService } from "./service";
import { MemoryStore } from "./test-store";

const context = vi.hoisted(() => ({
  service: undefined as CommerceService | undefined,
}));
vi.mock("./http", async (original) => ({
  ...(await original<typeof import("./http")>()),
  commerce: () => context.service!,
}));
import { GET } from "../../app/api/business/[[...path]]/route";

const endpoint = "https://deployment.example/api/checkout/webhooks/circle";
const serverKey = "fake-server-only-circle-key";
const subscription = {
  id: "private-subscription-id",
  name: "private-subscription-name",
  endpoint,
  enabled: true,
  notificationTypes: ["transactions.outbound"],
};
let ownerToken: string;
let readerToken: string;

function get(token?: string, path = ["checkout-health"]) {
  return GET(
    new Request(`https://deployment.example/api/business/${path.join("/")}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ path }) },
  );
}
function upstream(data: unknown) {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(async () => {
  context.service = new CommerceService(new MemoryStore());
  const created = await context.service.createWorkspace({
    name: "Health QA",
    recipient: "0x1111111111111111111111111111111111111111",
  });
  ownerToken = created.token;
  readerToken = (await context.service.issueReader(
    await context.service.authorize(ownerToken), "Reader",
  )).token;
  vi.stubEnv("CIRCLE_API_KEY", serverKey);
  vi.stubEnv("NEXT_PUBLIC_CIRCLE_APP_ID", "public-app-id");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "public-google-id");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("owner-only deployment checkout readiness", () => {
  it("rejects unauthenticated and read-only requests before contacting Circle", async () => {
    const fetcher = upstream([subscription]);
    expect((await get()).status).toBe(401);
    expect((await get(readerToken)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["transactions.outbound", "transactions.*", "*"])(
    "accepts only an active matching subscription covering %s, without exposing its metadata",
    async (type) => {
      const fetcher = upstream([{ ...subscription, notificationTypes: [type] }]);
      const response = await get(ownerToken);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        embeddedWalletReady: true,
        notificationSubscriptionReady: true,
        checkedAt: expect.any(String),
      });
      expect(Number.isFinite(Date.parse(body.checkedAt))).toBe(true);
      const [url, options] = fetcher.mock.calls[0];
      expect(url).toBe("https://api.circle.com/v2/notifications/subscriptions");
      expect(options).toMatchObject({
        method: "GET", redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${serverKey}` },
      });
      expect(options.body).toBeUndefined();
      expect(options.headers["X-User-Token"]).toBeUndefined();
      for (const hidden of [serverKey, ownerToken, subscription.id, subscription.name, endpoint])
        expect(JSON.stringify(body)).not.toContain(hidden);
    },
  );

  it.each([
    { ...subscription, enabled: false },
    { ...subscription, endpoint: "https://other.example/api/checkout/webhooks/circle" },
    { ...subscription, endpoint: `${endpoint}/` },
    { ...subscription, notificationTypes: ["transactions.inbound", "webhooks.test"] },
    { ...subscription, notificationTypes: [] },
  ])("does not report an unrelated, disabled or uncovered subscription as ready: %j", async (record) => {
    upstream([record]);
    const response = await get(ownerToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      embeddedWalletReady: true, notificationSubscriptionReady: false,
    });
  });

  it.each([
    undefined,
    { subscriptions: [subscription] },
    [{ ...subscription, enabled: "true" }],
    [{ ...subscription, endpoint: "not-a-url" }],
    [{ ...subscription, notificationTypes: ["transactions.outbound", 1] }],
    [subscription, null],
  ])("fails closed when subscription metadata is malformed: %j", async (data) => {
    upstream(data);
    const response = await get(ownerToken);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Circle returned invalid subscription metadata." });
  });

  it("returns not ready without a provider call when the API key is missing", async () => {
    vi.stubEnv("CIRCLE_API_KEY", "");
    const fetcher = upstream([subscription]);
    const response = await get(ownerToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      embeddedWalletReady: false, notificationSubscriptionReady: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps embedded configuration and subscription readiness separate", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    upstream([subscription]);
    const response = await get(ownerToken);
    expect(await response.json()).toMatchObject({
      embeddedWalletReady: false, notificationSubscriptionReady: true,
    });
  });

  it.each([401, 403, 503])("preserves provider failure semantics for HTTP %s and redacts its body", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      code: 3, message: `private-provider-response ${serverKey}`,
    }, { status })));
    const response = await get(ownerToken);
    expect(response.status).toBe(status === 401 ? 401 : 502);
    const body = await response.json();
    expect(body.error).toContain(`(${status})`);
    expect(body).not.toHaveProperty("notificationSubscriptionReady");
    expect(JSON.stringify(body)).not.toContain(serverKey);
    expect(JSON.stringify(body)).not.toContain("private-provider-response");
  });

  it("redacts transport failures instead of reporting readiness", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`private error ${serverKey}`)));
    const response = await get(ownerToken);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(serverKey);
  });

  it("does not contact Circle for a longer unmatched path", async () => {
    const fetcher = upstream([subscription]);
    expect((await get(ownerToken, ["checkout-health", "extra"])).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
