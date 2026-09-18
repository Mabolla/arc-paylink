import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Arc network configuration", () => {
  it("keeps the existing testnet configuration as the safe default", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "testnet");
    const arc = await import("./arc");
    expect(arc.ARC_CHAIN_ID).toBe(5_042_002);
    expect(arc.ARC_RPC_URL).toBe("https://rpc.testnet.arc.io");
    expect(arc.ARC_EXPLORER_URL).toBe("https://explorer.testnet.arc.io");
  });

  it("selects the official Arc mainnet endpoints only when explicitly enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "mainnet");
    const arc = await import("./arc");
    expect(arc.ARC_CHAIN_ID).toBe(5_042);
    expect(arc.ARC_RPC_URL).toBe("https://rpc.mainnet.arc.io");
    expect(arc.ARC_EXPLORER_URL).toBe("https://explorer.arc.io");
    expect(arc.arcChain.testnet).toBeUndefined();
  });

  it("limits the mainnet pilot to direct Arc invoice obligations", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "mainnet");
    const { createPaymentRequest } = await import("./payment-request");
    const base = {
      title: "Mainnet pilot",
      amount: "0.01",
      recipient: "0x0000000000000000000000000000000000000001",
      obligationId: "INV-MAINNET-1",
    };
    expect(createPaymentRequest({ ...base, route: "arc", obligationKind: "invoice" }).chainId).toBe(5_042);
    expect(() => createPaymentRequest({ ...base, route: "bridge", obligationKind: "invoice" })).toThrow("direct Arc");
    expect(() => createPaymentRequest({ ...base, route: "arc", obligationKind: "milestone" })).toThrow("invoice");
  });
});
