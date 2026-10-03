import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { ARC_USDC_ADDRESS } from "../arc";
import { parseUsdcAmount } from "../amount";
import type { PublicOrder } from "./types";

export type ExternalIntent = {
  payer: Address;
  idempotencyKey: string;
  nonce: number;
  expiresAt: string;
};

// A readable, order-specific EIP-191 reservation, not a token allowance or transfer.
export function externalPaymentMessage(order: PublicOrder, intent: ExternalIntent) {
  return [
    "Arc PayLink: reserve this checkout (v1)",
    `Order: ${order.id}`,
    `Chain ID: ${order.chainId}`,
    `USDC contract: ${ARC_USDC_ADDRESS}`,
    `Recipient: ${getAddress(order.recipient)}`,
    `Amount (USDC base units): ${parseUsdcAmount(order.amount)}`,
    `Payer: ${getAddress(intent.payer)}`,
    `Transaction nonce: ${intent.nonce}`,
    `Attempt: ${intent.idempotencyKey}`,
    `Expires: ${intent.expiresAt}`,
    "This signature reserves the order only. Approve the transfer separately in your wallet.",
  ].join("\n");
}

export function externalTransaction(order: PublicOrder, nonce: number) {
  return {
    chainId: order.chainId,
    to: ARC_USDC_ADDRESS,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [order.recipient, parseUsdcAmount(order.amount)],
    }),
    value: "0",
    nonce,
  };
}
