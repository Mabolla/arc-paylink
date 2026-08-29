import { keccak256, stringToHex, type Hash } from "viem";
import type { SettlementCorrelationRecord } from "./settlement-correlation";

export type ControlledRecoveryPlan = {
  schemaVersion: 1;
  planId: Hash;
  correlationId: Hash;
  paymentReference: Hash;
  obligation: SettlementCorrelationRecord["obligation"];
  settlementState: SettlementCorrelationRecord["settlement"]["state"];
  status: "no-action" | "ready" | "rejected" | "manual-review";
  action: SettlementCorrelationRecord["settlement"]["recoveryAction"];
  outstandingBaseUnits: string;
  instruction: string;
  fundMovement: false;
  executable: false;
};

const INSTRUCTIONS: Record<SettlementCorrelationRecord["settlement"]["state"], string> = {
  settled: "The obligation is already settled. No recovery action is allowed.",
  "fee-adjusted": "The obligation is complete with a recorded bridge fee. No recovery action is allowed.",
  pending: "Wait for destination finality, then verify the existing payment reference again.",
  partial: "Prepare a separate top-up request for the exact outstanding amount. This plan does not transfer funds.",
  duplicate: "Reject the duplicate recovery request and preserve the original settlement record.",
  mismatched: "Stop automated processing and send the settlement evidence to manual review.",
};

export function createControlledRecoveryPlan(record: SettlementCorrelationRecord, paymentReference: Hash): ControlledRecoveryPlan {
  if (record.source.burnTransactionHash.toLowerCase() !== paymentReference.toLowerCase()) {
    throw new Error("Payment reference does not match the immutable source evidence.");
  }
  const state = record.settlement.state;
  const status = state === "settled" || state === "fee-adjusted" ? "no-action" : state === "duplicate" ? "rejected" : state === "mismatched" ? "manual-review" : "ready";
  const planId = keccak256(stringToHex(`${record.correlationId.toLowerCase()}:${paymentReference.toLowerCase()}:${record.settlement.recoveryAction}`));
  return {
    schemaVersion: 1,
    planId,
    correlationId: record.correlationId,
    paymentReference,
    obligation: record.obligation,
    settlementState: state,
    status,
    action: record.settlement.recoveryAction,
    outstandingBaseUnits: record.settlement.outstandingBaseUnits,
    instruction: INSTRUCTIONS[state],
    fundMovement: false,
    executable: false,
  };
}
