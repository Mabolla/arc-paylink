import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters, erc20Abi, type TransactionReceipt } from "viem";
import { ARC_USDC_ADDRESS } from "./arc";
import { verifyTransferLog } from "./verify-payment";

const from = "0x0000000000000000000000000000000000000001" as const;
const recipient = "0x0000000000000000000000000000000000000002" as const;

function receipt(overrides: Partial<TransactionReceipt> = {}): TransactionReceipt {
  const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to: recipient } });
  return {
    status: "success", transactionHash: `0x${"1".repeat(64)}`, transactionIndex: 0, blockHash: `0x${"2".repeat(64)}`,
    blockNumber: 1n, from, to: ARC_USDC_ADDRESS, cumulativeGasUsed: 1n, gasUsed: 1n, effectiveGasPrice: 1n,
    contractAddress: null, logsBloom: `0x${"0".repeat(512)}`, type: "eip1559",
    logs: [{ address: ARC_USDC_ADDRESS, topics, data: encodeAbiParameters([{ type: "uint256" }], [1_500_000n]), blockNumber: 1n, transactionHash: `0x${"1".repeat(64)}`, transactionIndex: 0, blockHash: `0x${"2".repeat(64)}`, logIndex: 0, removed: false }],
    ...overrides,
  } as TransactionReceipt;
}

describe("Arc payment verification", () => {
  it("accepts the exact USDC recipient and amount", () => expect(verifyTransferLog(receipt(), { recipient, amountBaseUnits: 1_500_000n }).recipient).toBe(recipient));
  it("rejects failed receipts", () => expect(() => verifyTransferLog(receipt({ status: "reverted" }), { recipient, amountBaseUnits: 1_500_000n })).toThrow("failed"));
  it("rejects an incorrect amount", () => expect(() => verifyTransferLog(receipt(), { recipient, amountBaseUnits: 1_500_001n })).toThrow("No matching"));
  it("rejects an incorrect recipient", () => expect(() => verifyTransferLog(receipt(), { recipient: from, amountBaseUnits: 1_500_000n })).toThrow("No matching"));
});
