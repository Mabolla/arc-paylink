import type { Hash, PublicClient } from "viem";
import { ARC_CHAIN_ID } from "../src/lib/arc";
import { parseUsdcAmount } from "../src/lib/amount";
import type { PaymentRequest } from "../src/lib/payment-request";
import { verifyTransferLog } from "../src/lib/verify-payment";
import type { VerifiedPayment } from "./workflow";

export async function verifyAgentPayment(client: Pick<PublicClient, "getChainId" | "waitForTransactionReceipt" | "getBlock">, hash: Hash, expected: PaymentRequest): Promise<VerifiedPayment> {
  if (expected.chainId !== ARC_CHAIN_ID || await client.getChainId() !== ARC_CHAIN_ID) throw new Error("RPC network does not match the PayLink Arc network.");
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("RPC returned a different transaction.");
  const transfer = verifyTransferLog(receipt, { recipient: expected.recipient, amountBaseUnits: parseUsdcAmount(expected.amount) });
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  return { ...transfer, transactionHash: hash, blockNumber: receipt.blockNumber, blockTimestamp: block.timestamp };
}
