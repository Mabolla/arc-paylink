import type { BridgeResult } from "@circle-fin/bridge-kit";
import type { TransactionReceipt } from "viem";
import { ARC_USDC_ADDRESS, arcTestnet } from "./arc";
import type { PaymentRequest } from "./payment-request";
import { verifyBridgeSettlement, type BridgeSettlementVerification } from "./verify-bridge-settlement";
import { classifySettlement, type SettlementClassification } from "./settlement-state";

export type PaymentSettlementResult = BridgeSettlementVerification & {
  paymentState: SettlementClassification["state"];
  recoveryAction: SettlementClassification["recoveryAction"];
  outstandingBaseUnits: bigint;
  obligation: PaymentRequest["obligation"];
};

export function settlePaymentRequest({
  request,
  bridgeResult,
  destinationReceipt,
}: {
  request: PaymentRequest;
  bridgeResult: BridgeResult;
  destinationReceipt?: TransactionReceipt;
}): PaymentSettlementResult {
  if (request.route !== "bridge") throw new Error("Settlement adapter requires a bridge payment request.");
  const verified = verifyBridgeSettlement({
    bridgeResult,
    destinationReceipt,
    expectedRecipient: request.recipient,
    expectedAmount: request.amount,
    expectedToken: ARC_USDC_ADDRESS,
    chain: arcTestnet,
  });
  const classification = classifySettlement({
    expectedRecipient: request.recipient,
    actualRecipient: verified.recipient,
    expectedAmountBaseUnits: verified.grossAmountBaseUnits,
    recipientAmountBaseUnits: verified.amountBaseUnits,
    bridgeFeeBaseUnits: verified.bridgeFeeBaseUnits,
    destinationFinalized: true,
  });
  return { ...verified, paymentState: classification.state, recoveryAction: classification.recoveryAction, outstandingBaseUnits: classification.outstandingBaseUnits, obligation: request.obligation };
}
