import type { BridgeResult } from "@circle-fin/bridge-kit";
import {
  decodeEventLog,
  erc20Abi,
  isAddress,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "./arc";
import { parseUsdcAmount } from "./amount";

export type FulfillmentCheck =
  | { state: "available"; fulfillmentId: string }
  | { state: "duplicate"; fulfillmentId: string };

export type BridgeSettlementVerification = {
  state: "verified";
  mintTransactionHash: Hash;
  blockNumber: bigint;
  sender: Address;
  recipient: Address;
  token: Address;
  amountBaseUnits: bigint;
  fulfillmentId?: string;
};

export type VerifyBridgeSettlementInput = {
  bridgeResult: BridgeResult;
  destinationReceipt?: TransactionReceipt;
  expectedRecipient: string;
  expectedAmount: string;
  expectedToken: string;
  chain: { id: number };
  fulfillmentId?: string;
};

function fail(message: string): never {
  throw new Error(`Bridge settlement verification failed: ${message}`);
}

export function checkFulfillment(
  fulfillmentId: string,
  usedFulfillmentIds: ReadonlySet<string>,
): FulfillmentCheck {
  return usedFulfillmentIds.has(fulfillmentId)
    ? { state: "duplicate", fulfillmentId }
    : { state: "available", fulfillmentId };
}

export function verifyBridgeSettlement({
  bridgeResult,
  destinationReceipt,
  expectedRecipient,
  expectedAmount,
  expectedToken,
  chain,
  fulfillmentId,
}: VerifyBridgeSettlementInput): BridgeSettlementVerification {
  if (bridgeResult.state !== "success") fail("bridge result is not successful");
  if (chain.id !== ARC_CHAIN_ID || bridgeResult.destination.chain.type !== "evm" || bridgeResult.destination.chain.chainId !== ARC_CHAIN_ID) {
    fail("destination chain is not Arc Testnet");
  }
  if (bridgeResult.destination.useForwarder === true) fail("forwarder-only bridge flow is unsupported");
  const mint = bridgeResult.steps.find((step) => step.name.toLowerCase() === "mint");
  if (!mint) fail("mint step is missing");
  if (mint.forwarded === true) fail("forwarded mint step is unsupported");
  if (mint.state !== "success") fail("mint step is not successful");
  if (!mint.txHash || !/^0x[0-9a-fA-F]{64}$/.test(mint.txHash)) fail("mint transaction hash is missing or invalid");
  if (!destinationReceipt) fail("destination receipt is missing");
  if (destinationReceipt.status !== "success") fail("destination receipt reverted");
  if (destinationReceipt.transactionHash.toLowerCase() !== mint.txHash.toLowerCase()) fail("receipt does not match mint transaction");
  if (!isAddress(expectedRecipient, { strict: false }) || !isAddress(expectedToken, { strict: false })) fail("expected address is invalid");
  if (expectedToken.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) fail("unexpected token contract");
  if (bridgeResult.destination.recipientAddress && bridgeResult.destination.recipientAddress.toLowerCase() !== expectedRecipient.toLowerCase()) {
    fail("bridge recipient disagrees with expectation");
  }
  const amount = parseUsdcAmount(expectedAmount);
  if (bridgeResult.token !== "USDC" || parseUsdcAmount(bridgeResult.amount) !== amount) fail("bridge amount/token disagrees with expectation");
  const logs = destinationReceipt.logs.filter((log) => log.address.toLowerCase() === expectedToken.toLowerCase());
  const matches: Array<{ from: Address; to: Address; value: bigint }> = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics, eventName: "Transfer" });
      if (decoded.eventName === "Transfer") matches.push(decoded.args as { from: Address; to: Address; value: bigint });
    } catch {
      // Ignore unrelated or non-Transfer logs emitted by the token contract.
    }
  }
  const exact = matches.filter((event) => event.to.toLowerCase() === expectedRecipient.toLowerCase() && event.value === amount);
  if (exact.length !== 1) fail(exact.length === 0 ? "no exact Transfer settlement found" : "multiple exact Transfer settlements found");
  return {
    state: "verified",
    mintTransactionHash: mint.txHash as Hash,
    blockNumber: destinationReceipt.blockNumber,
    sender: exact[0].from,
    recipient: exact[0].to,
    token: expectedToken as Address,
    amountBaseUnits: exact[0].value,
    fulfillmentId,
  };
}
