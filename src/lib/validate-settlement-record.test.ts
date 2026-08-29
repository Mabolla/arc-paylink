import { describe, expect, it } from "vitest";
import { buildSettlementCorrelationRecord } from "./settlement-correlation";
import { validateSettlementCorrelationRecord } from "./validate-settlement-record";

const hash = (digit: string) => `0x${digit.repeat(64)}`;
function record() {
  return buildSettlementCorrelationRecord({
    obligation: { kind: "milestone", id: "M-12" },
    bridgeResult: {
      source: { chain: { type: "evm", chainId: 84532 } },
      destination: { chain: { type: "evm", chainId: 5042002 } },
      steps: [
        { name: "burn", txHash: hash("1") },
        { name: "attestation", data: { eventNonce: "9", message: "0x1234", attestation: "0xabcd", status: "complete" } },
        { name: "mint", txHash: hash("2") },
      ],
    } as never,
    settlement: { paymentState: "settled", recoveryAction: "none", grossAmountBaseUnits: 1n, amountBaseUnits: 1n, bridgeFeeBaseUnits: 0n, outstandingBaseUnits: 0n, blockNumber: 3n } as never,
    observedAt: "2026-08-29T08:00:00.000Z",
  });
}

describe("validateSettlementCorrelationRecord", () => {
  it("returns a sanitized valid record", () => {
    const input = { ...record(), ignored: "not persisted" };
    expect(validateSettlementCorrelationRecord(input)).toEqual(record());
  });

  it("rejects tampered correlation, evidence order, and recovery action", () => {
    expect(() => validateSettlementCorrelationRecord({ ...record(), correlationId: hash("f") })).toThrow("Correlation ID");
    const badEvents = record();
    badEvents.events[0].reference = hash("f");
    expect(() => validateSettlementCorrelationRecord(badEvents)).toThrow("Event 1");
    const badAction = record();
    badAction.settlement.recoveryAction = "manual-review";
    expect(() => validateSettlementCorrelationRecord(badAction)).toThrow("Recovery action");
  });

  it("rejects unexpected chains and malformed amounts", () => {
    expect(() => validateSettlementCorrelationRecord({ ...record(), source: { ...record().source, chainId: 1 } })).toThrow("Base Sepolia");
    expect(() => validateSettlementCorrelationRecord({ ...record(), settlement: { ...record().settlement, grossAmountBaseUnits: "01" } })).toThrow("Gross amount");
  });
});
