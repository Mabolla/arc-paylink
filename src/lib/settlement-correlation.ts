import type { BridgeResult } from "@circle-fin/bridge-kit";
import { isHex, keccak256, stringToHex, type Hash } from "viem";
import type { PaymentObligation } from "./obligation";
import type { PaymentSettlementResult } from "./settle-payment-request";

export type SettlementEventType = "source-burn" | "attestation-observed" | "destination-mint" | "settlement-classified";

export type SettlementCorrelationRecord = {
  schemaVersion: 1;
  correlationId: Hash;
  obligation: PaymentObligation;
  source: { chainId: number; burnTransactionHash: Hash };
  cctp: { eventNonce: string; messageHash: Hash; attestationHash: Hash; status: string };
  destination: { chainId: number; mintTransactionHash: Hash; blockNumber: string };
  settlement: {
    state: PaymentSettlementResult["paymentState"];
    recoveryAction: PaymentSettlementResult["recoveryAction"];
    grossAmountBaseUnits: string;
    recipientAmountBaseUnits: string;
    bridgeFeeBaseUnits: string;
    outstandingBaseUnits: string;
  };
  events: Array<{ sequence: number; type: SettlementEventType; observedAt: string; reference: string }>;
};

type AttestationData = {
  message?: unknown;
  eventNonce?: unknown;
  attestation?: unknown;
  status?: unknown;
};

function validHash(value: unknown, label: string): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`Correlation record requires a valid ${label}.`);
  return value as Hash;
}

function evidenceHash(value: unknown, label: string): Hash {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Correlation record requires ${label}.`);
  return keccak256(isHex(value) ? value : stringToHex(value));
}

export function buildSettlementCorrelationRecord({
  obligation,
  bridgeResult,
  settlement,
  observedAt,
}: {
  obligation: PaymentObligation;
  bridgeResult: BridgeResult;
  settlement: PaymentSettlementResult;
  observedAt: string;
}): SettlementCorrelationRecord {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("Correlation record requires a valid observation time.");
  const burn = bridgeResult.steps.find((step) => step.name.toLowerCase() === "burn");
  const attestationStep = bridgeResult.steps.find((step) => step.name.toLowerCase().includes("attestation"));
  const mint = bridgeResult.steps.find((step) => step.name.toLowerCase() === "mint");
  const burnTransactionHash = validHash(burn?.txHash, "source burn transaction hash");
  const mintTransactionHash = validHash(mint?.txHash, "destination mint transaction hash");
  if (bridgeResult.source.chain.type !== "evm" || bridgeResult.destination.chain.type !== "evm") {
    throw new Error("Correlation record requires EVM source and destination chains.");
  }
  const data = (attestationStep as unknown as { data?: AttestationData } | undefined)?.data;
  if (!data || typeof data.eventNonce !== "string" || typeof data.status !== "string") {
    throw new Error("Correlation record requires completed CCTP attestation metadata.");
  }
  const messageHash = evidenceHash(data.message, "CCTP message");
  const attestationHash = evidenceHash(data.attestation, "CCTP attestation");
  const correlationId = keccak256(stringToHex(`${obligation.kind}:${obligation.id}:${burnTransactionHash.toLowerCase()}`));
  return {
    schemaVersion: 1,
    correlationId,
    obligation,
    source: { chainId: bridgeResult.source.chain.chainId, burnTransactionHash },
    cctp: { eventNonce: data.eventNonce, messageHash, attestationHash, status: data.status },
    destination: {
      chainId: bridgeResult.destination.chain.chainId,
      mintTransactionHash,
      blockNumber: settlement.blockNumber.toString(),
    },
    settlement: {
      state: settlement.paymentState,
      recoveryAction: settlement.recoveryAction,
      grossAmountBaseUnits: settlement.grossAmountBaseUnits.toString(),
      recipientAmountBaseUnits: settlement.amountBaseUnits.toString(),
      bridgeFeeBaseUnits: settlement.bridgeFeeBaseUnits.toString(),
      outstandingBaseUnits: settlement.outstandingBaseUnits.toString(),
    },
    events: [
      { sequence: 1, type: "source-burn", observedAt, reference: burnTransactionHash },
      { sequence: 2, type: "attestation-observed", observedAt, reference: messageHash },
      { sequence: 3, type: "destination-mint", observedAt, reference: mintTransactionHash },
      { sequence: 4, type: "settlement-classified", observedAt, reference: settlement.paymentState },
    ],
  };
}
