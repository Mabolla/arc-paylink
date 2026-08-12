import {
  decodeEventLog,
  erc20Abi,
  getAddress,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "./arc";
import { parseUsdcAmount } from "./amount";

export type VerificationResult = {
  transactionHash: Hash;
  blockNumber: bigint;
  sender: Address;
  recipient: Address;
  amountBaseUnits: bigint;
};

export function verifyTransferLog(
  receipt: TransactionReceipt,
  expected: { recipient: Address; amountBaseUnits: bigint },
): Omit<VerificationResult, "transactionHash" | "blockNumber"> {
  if (receipt.status !== "success") throw new Error("The Arc transaction failed.");

  const expectedRecipient = getAddress(expected.recipient);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
      const { from, to, value } = decoded.args;
      if (getAddress(to) === expectedRecipient && value === expected.amountBaseUnits) {
        return { sender: getAddress(from), recipient: getAddress(to), amountBaseUnits: value };
      }
    } catch {
      // Ignore unrelated logs emitted by the token contract.
    }
  }
  throw new Error("No matching Arc USDC transfer was found in the receipt.");
}

export async function verifyPaymentReceipt(
  client: PublicClient,
  hash: Hash,
  expected: { recipient: Address; amount: string },
): Promise<VerificationResult> {
  if (client.chain?.id !== ARC_CHAIN_ID) throw new Error("Receipt verification must use Arc Testnet.");
  const receipt = await client.waitForTransactionReceipt({ hash });
  const transfer = verifyTransferLog(receipt, {
    recipient: expected.recipient,
    amountBaseUnits: parseUsdcAmount(expected.amount),
  });
  return { transactionHash: hash, blockNumber: receipt.blockNumber, ...transfer };
}
