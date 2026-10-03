import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("collections network selection", () => {
  it("keeps a mainnet collection on mainnet despite a stale legacy testnet RPC override", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "mainnet");
    vi.stubEnv("NEXT_PUBLIC_ARC_RPC_URL", "https://rpc.testnet.arc.io");
    vi.resetModules();
    const { commerceChain, COMMERCE_RPC_URL } = await import("./network");
    expect(commerceChain.id).toBe(5042);
    expect(COMMERCE_RPC_URL).toBe("https://rpc.mainnet.arc.io");
  });
  it("does not move an explicitly selected testnet collection onto mainnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "testnet");
    vi.stubEnv("NEXT_PUBLIC_ARC_RPC_URL", "https://rpc.mainnet.arc.io");
    vi.resetModules();
    const { commerceChain, COMMERCE_RPC_URL } = await import("./network");
    expect(commerceChain.id).toBe(5042002);
    expect(COMMERCE_RPC_URL).toBe("https://rpc.testnet.arc.io");
  });
});
