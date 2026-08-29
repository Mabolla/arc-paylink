import { keccak256, stringToHex, type Hash } from "viem";
import { ARC_CHAIN_ID } from "./arc";
import { createObligation } from "./obligation";
import type { SettlementCorrelationRecord, SettlementEventType } from "./settlement-correlation";
import type { RecoveryAction, SettlementState } from "./settlement-state";

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const STATE_ACTION: Record<SettlementState, RecoveryAction> = {
  pending: "await-destination",
  settled: "none",
  "fee-adjusted": "record-fee",
  partial: "request-top-up",
  duplicate: "reject-duplicate",
  mismatched: "manual-review",
};
const EVENT_TYPES: SettlementEventType[] = ["source-burn", "attestation-observed", "destination-mint", "settlement-classified"];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function hash(value: unknown, label: string): Hash {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} must be a 32-byte hash.`);
  return value as Hash;
}

function text(value: unknown, label: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`${label} is invalid.`);
  return value;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new Error(`${label} must be an unsigned decimal string.`);
  return value;
}

export function validateSettlementCorrelationRecord(input: unknown): SettlementCorrelationRecord {
  const root = object(input, "Settlement record");
  if (root.schemaVersion !== 1) throw new Error("Unsupported settlement record schema.");

  const obligationInput = object(root.obligation, "Obligation");
  const obligation = createObligation({ kind: obligationInput.kind as string | undefined, id: obligationInput.id as string | undefined });
  if (!obligation) throw new Error("Settlement record requires an obligation.");

  const sourceInput = object(root.source, "Source");
  if (sourceInput.chainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error("Source chain must be Base Sepolia.");
  const burnTransactionHash = hash(sourceInput.burnTransactionHash, "Source burn transaction hash");

  const cctpInput = object(root.cctp, "CCTP evidence");
  const eventNonce = text(cctpInput.eventNonce, "CCTP event nonce");
  const messageHash = hash(cctpInput.messageHash, "CCTP message hash");
  const attestationHash = hash(cctpInput.attestationHash, "CCTP attestation hash");
  const cctpStatus = text(cctpInput.status, "CCTP status", 64);

  const destinationInput = object(root.destination, "Destination");
  if (destinationInput.chainId !== ARC_CHAIN_ID) throw new Error("Destination chain must be Arc Testnet.");
  const mintTransactionHash = hash(destinationInput.mintTransactionHash, "Destination mint transaction hash");
  const blockNumber = decimal(destinationInput.blockNumber, "Destination block number");

  const settlementInput = object(root.settlement, "Settlement");
  const state = settlementInput.state as SettlementState;
  if (!(state in STATE_ACTION)) throw new Error("Settlement state is invalid.");
  const recoveryAction = settlementInput.recoveryAction as RecoveryAction;
  if (STATE_ACTION[state] !== recoveryAction) throw new Error("Recovery action does not match settlement state.");
  const settlement = {
    state,
    recoveryAction,
    grossAmountBaseUnits: decimal(settlementInput.grossAmountBaseUnits, "Gross amount"),
    recipientAmountBaseUnits: decimal(settlementInput.recipientAmountBaseUnits, "Recipient amount"),
    bridgeFeeBaseUnits: decimal(settlementInput.bridgeFeeBaseUnits, "Bridge fee"),
    outstandingBaseUnits: decimal(settlementInput.outstandingBaseUnits, "Outstanding amount"),
  };

  if (!Array.isArray(root.events) || root.events.length !== EVENT_TYPES.length) throw new Error("Settlement record requires exactly four audit events.");
  const expectedReferences = [burnTransactionHash, messageHash, mintTransactionHash, state];
  const events = root.events.map((value, index) => {
    const event = object(value, `Event ${index + 1}`);
    if (event.sequence !== index + 1 || event.type !== EVENT_TYPES[index] || event.reference !== expectedReferences[index]) {
      throw new Error(`Event ${index + 1} does not match the settlement evidence.`);
    }
    const observedAt = text(event.observedAt, `Event ${index + 1} observation time`, 64);
    if (!Number.isFinite(Date.parse(observedAt))) throw new Error(`Event ${index + 1} observation time is invalid.`);
    return { sequence: index + 1, type: EVENT_TYPES[index], observedAt, reference: expectedReferences[index] };
  });

  const correlationId = hash(root.correlationId, "Correlation ID");
  const expectedCorrelationId = keccak256(stringToHex(`${obligation.kind}:${obligation.id}:${burnTransactionHash.toLowerCase()}`));
  if (correlationId.toLowerCase() !== expectedCorrelationId.toLowerCase()) throw new Error("Correlation ID does not match the immutable source evidence.");

  return {
    schemaVersion: 1,
    correlationId,
    obligation,
    source: { chainId: BASE_SEPOLIA_CHAIN_ID, burnTransactionHash },
    cctp: { eventNonce, messageHash, attestationHash, status: cctpStatus },
    destination: { chainId: ARC_CHAIN_ID, mintTransactionHash, blockNumber },
    settlement,
    events,
  };
}
