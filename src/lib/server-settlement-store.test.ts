import { describe, expect, it, vi } from "vitest";
import { buildSettlementCorrelationRecord } from "./settlement-correlation";
import { persistSettlementRecord } from "./server-settlement-store";

const hash = (digit: string) => `0x${digit.repeat(64)}`;

function record() {
  return buildSettlementCorrelationRecord({
    obligation: { kind: "invoice", id: "INV-7" },
    bridgeResult: {
      source: { chain: { type: "evm", chainId: 84532 } },
      destination: { chain: { type: "evm", chainId: 5042002 } },
      steps: [
        { name: "burn", txHash: hash("1") },
        { name: "attestation", data: { eventNonce: "7", message: "0x1234", attestation: "0xabcd", status: "complete" } },
        { name: "mint", txHash: hash("2") },
      ],
    } as never,
    settlement: {
      paymentState: "settled",
      recoveryAction: "none",
      grossAmountBaseUnits: 1_000_000n,
      amountBaseUnits: 1_000_000n,
      bridgeFeeBaseUnits: 0n,
      outstandingBaseUnits: 0n,
      blockNumber: 12n,
    } as never,
    observedAt: "2026-08-29T08:00:00.000Z",
  });
}

describe("persistSettlementRecord", () => {
  it("creates an immutable content-addressed object", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    expect(await persistSettlementRecord(record(), { list: vi.fn().mockResolvedValue([]), put })).toBe("created");
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][0]).toMatch(/^settlements\/v1\/0x[0-9a-f]{64}\/[0-9a-f]{64}\.json$/);
  });

  it("is idempotent for identical content and preserves conflicts", async () => {
    const firstPut = vi.fn().mockResolvedValue(undefined);
    const value = record();
    await persistSettlementRecord(value, { list: vi.fn().mockResolvedValue([]), put: firstPut });
    const pathname = firstPut.mock.calls[0][0];
    expect(await persistSettlementRecord(value, { list: vi.fn().mockResolvedValue([pathname]), put: vi.fn() })).toBe("unchanged");
    expect(await persistSettlementRecord(value, { list: vi.fn().mockResolvedValue([`${pathname}.different`]), put: vi.fn() })).toBe("conflict");
  });

  it("handles concurrent immutable writes without overwriting", async () => {
    const value = record();
    const initialPut = vi.fn().mockResolvedValue(undefined);
    await persistSettlementRecord(value, { list: vi.fn().mockResolvedValue([]), put: initialPut });
    const pathname = initialPut.mock.calls[0][0];
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([pathname]);
    expect(await persistSettlementRecord(value, { list, put: vi.fn().mockRejectedValue(new Error("precondition")) })).toBe("unchanged");
  });
});
