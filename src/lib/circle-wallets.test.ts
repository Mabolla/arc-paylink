import { describe, expect, it, vi } from "vitest";
import { getCircleWalletConfig, initializeArcUserWallet, isCircleUserToken } from "./circle-wallets";

describe("Circle wallet configuration", () => {
  it("requires a server-side API key", () => {
    expect(() => getCircleWalletConfig({})).toThrow("not configured");
  });

  it("normalizes the Circle base URL", () => {
    expect(
      getCircleWalletConfig({ CIRCLE_API_KEY: "test-key", CIRCLE_BASE_URL: "https://example.test/" }),
    ).toEqual({ apiKey: "test-key", baseUrl: "https://example.test" });
  });

  it("rejects non-HTTPS API origins", () => {
    expect(() =>
      getCircleWalletConfig({ CIRCLE_API_KEY: "test-key", CIRCLE_BASE_URL: "http://example.test" }),
    ).toThrow("HTTPS");
  });
});

describe("Circle Arc user initialization", () => {
  it("accepts bounded opaque user tokens", () => {
    expect(isCircleUserToken("a".repeat(16))).toBe(true);
    expect(isCircleUserToken("short")).toBe(false);
    expect(isCircleUserToken("a".repeat(8193))).toBe(false);
  });

  it("creates only an Arc Testnet smart account", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: { challengeId: "challenge-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      initializeArcUserWallet("u".repeat(32), {
        env: { CIRCLE_API_KEY: "secret-api-key" },
        fetcher,
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
      }),
    ).resolves.toEqual({ challengeId: "challenge-1" });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.circle.com/v1/w3s/user/initialize");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer secret-api-key",
      "X-User-Token": "u".repeat(32),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      idempotencyKey: "00000000-0000-4000-8000-000000000000",
      accountType: "SCA",
      blockchains: ["ARC-TESTNET"],
    });
  });

  it("does not expose Circle error payloads", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message: "request rejected", sensitive: "do-not-return" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      initializeArcUserWallet("u".repeat(32), {
        env: { CIRCLE_API_KEY: "secret-api-key" },
        fetcher,
      }),
    ).rejects.toThrow("request rejected");
  });
});
