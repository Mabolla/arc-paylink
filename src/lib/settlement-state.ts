export type SettlementState = "pending" | "settled" | "fee-adjusted" | "partial" | "duplicate" | "mismatched";
export type RecoveryAction = "await-destination" | "none" | "record-fee" | "request-top-up" | "reject-duplicate" | "manual-review";

export type SettlementClassification = {
  state: SettlementState;
  recoveryAction: RecoveryAction;
  outstandingBaseUnits: bigint;
};

export function classifySettlement(input: {
  expectedRecipient: string;
  actualRecipient?: string;
  expectedAmountBaseUnits: bigint;
  recipientAmountBaseUnits?: bigint;
  bridgeFeeBaseUnits?: bigint;
  destinationFinalized: boolean;
  duplicate?: boolean;
}): SettlementClassification {
  if (input.duplicate) return { state: "duplicate", recoveryAction: "reject-duplicate", outstandingBaseUnits: input.expectedAmountBaseUnits };
  if (!input.destinationFinalized || input.recipientAmountBaseUnits === undefined) {
    return { state: "pending", recoveryAction: "await-destination", outstandingBaseUnits: input.expectedAmountBaseUnits };
  }
  if (!input.actualRecipient || input.actualRecipient.toLowerCase() !== input.expectedRecipient.toLowerCase()) {
    return { state: "mismatched", recoveryAction: "manual-review", outstandingBaseUnits: input.expectedAmountBaseUnits };
  }
  const received = input.recipientAmountBaseUnits;
  const expected = input.expectedAmountBaseUnits;
  const fee = input.bridgeFeeBaseUnits ?? 0n;
  if (received === expected) return { state: "settled", recoveryAction: "none", outstandingBaseUnits: 0n };
  if (received < expected && received + fee === expected && fee > 0n) {
    return { state: "fee-adjusted", recoveryAction: "record-fee", outstandingBaseUnits: 0n };
  }
  if (received > expected) return { state: "mismatched", recoveryAction: "manual-review", outstandingBaseUnits: 0n };
  return {
    state: "partial",
    recoveryAction: "request-top-up",
    outstandingBaseUnits: received < expected ? expected - received : 0n,
  };
}
