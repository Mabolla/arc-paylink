import { describe, expect, it } from "vitest";
import type { SettlementCorrelationRecord } from "./settlement-correlation";
import { createControlledRecoveryPlan } from "./recovery-plan";

const burn = `0x${"1".repeat(64)}` as const;
const baseRecord = {
  schemaVersion: 1,
  correlationId: `0x${"2".repeat(64)}`,
  obligation: { kind: "invoice", id: "INV-7" },
  source: { chainId: 84532, burnTransactionHash: burn },
  settlement: { state: "settled", recoveryAction: "none", outstandingBaseUnits: "0" },
} as unknown as SettlementCorrelationRecord;

function record(state: SettlementCorrelationRecord["settlement"]["state"], action: SettlementCorrelationRecord["settlement"]["recoveryAction"], outstandingBaseUnits = "0") {
  return { ...baseRecord, settlement: { ...baseRecord.settlement, state, recoveryAction: action, outstandingBaseUnits } } as SettlementCorrelationRecord;
}

describe("createControlledRecoveryPlan", () => {
  it.each([
    ["settled", "none", "no-action"],
    ["fee-adjusted", "record-fee", "no-action"],
    ["pending", "await-destination", "ready"],
    ["partial", "request-top-up", "ready"],
    ["duplicate", "reject-duplicate", "rejected"],
    ["mismatched", "manual-review", "manual-review"],
  ] as const)("maps %s to a non-executable %s plan", (state, action, status) => {
    const plan = createControlledRecoveryPlan(record(state, action, state === "partial" ? "100" : "0"), burn);
    expect(plan).toMatchObject({ settlementState: state, action, status, fundMovement: false, executable: false });
  });

  it("is deterministic and rejects the wrong payment reference", () => {
    const first = createControlledRecoveryPlan(record("pending", "await-destination"), burn);
    const second = createControlledRecoveryPlan(record("pending", "await-destination"), burn);
    expect(second.planId).toBe(first.planId);
    expect(() => createControlledRecoveryPlan(record("pending", "await-destination"), `0x${"f".repeat(64)}`)).toThrow("Payment reference");
  });
});
