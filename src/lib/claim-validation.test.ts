import { describe, expect, it } from "vitest";
import { ARC_PAYLINK_FACTORY } from "@/lib/claim-package";
import { verifyClaimContext } from "@/lib/claim-validation";
import { ARC_USDC_ADDRESS } from "@/lib/arc";

const paymentId = `0x${"22".repeat(32)}` as const;
const secretHash = `0x${"33".repeat(32)}` as const;
const escrow = "0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B";
const expiry = 1_800_000_000;

function input() {
  return {
    factory: ARC_PAYLINK_FACTORY,
    paymentId,
    escrow,
    amountBaseUnits: "10000",
    expiry: new Date(expiry * 1000).toISOString(),
    secretHash,
  };
}

function reader(overrides: Partial<Record<string, unknown>> = {}) {
  const values: Record<string, unknown> = {
    escrows: escrow,
    token: ARC_USDC_ADDRESS,
    amount: 10_000n,
    expiry: BigInt(expiry),
    secretHash,
    state: 1,
    ...overrides,
  };
  return { readContract: async ({ functionName }: { functionName: string }) => values[functionName] };
}

describe("verifyClaimContext", () => {
  it("accepts a funded escrow registered by the trusted factory", async () => {
    await expect(verifyClaimContext(input(), reader(), 1_700_000_000)).resolves.toMatchObject({ escrow, amountBaseUnits: 10_000n });
  });

  it("rejects an escrow not registered for the payment ID", async () => {
    await expect(verifyClaimContext(input(), reader({ escrows: "0x0000000000000000000000000000000000000001" }), 1_700_000_000))
      .rejects.toThrow("Escrow is not registered");
  });

  it("rejects an escrow that is no longer funded", async () => {
    await expect(verifyClaimContext(input(), reader({ state: 2 }), 1_700_000_000))
      .rejects.toThrow("not funded and claimable");
  });

  it("rejects package data that disagrees with the onchain amount", async () => {
    await expect(verifyClaimContext(input(), reader({ amount: 20_000n }), 1_700_000_000))
      .rejects.toThrow("Claim amount does not match");
  });
});
