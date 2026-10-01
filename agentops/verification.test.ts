import { encodeAbiParameters, encodeEventTopics, erc20Abi, type PublicClient, type TransactionReceipt } from "viem";
import { describe, expect, it, vi } from "vitest";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "../src/lib/arc";
import { buyer, hash, proof, vendor, view } from "./test-fixtures";
import { verifyAgentPayment } from "./verification";

function setup() {
  const receipt = {
    status: "success", transactionHash: hash, blockNumber: 123n, blockHash: `0x${"b".repeat(64)}`,
    logs: [{
      address: ARC_USDC_ADDRESS,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: buyer, to: vendor } }),
      data: encodeAbiParameters([{ type: "uint256" }], [5_000_000n]),
    }],
  } as unknown as TransactionReceipt;
  const client = {
    getChainId: vi.fn().mockResolvedValue(ARC_CHAIN_ID),
    waitForTransactionReceipt: vi.fn().mockResolvedValue(receipt),
    getBlock: vi.fn().mockResolvedValue({ timestamp: proof.blockTimestamp }),
  };
  return { receipt, client, verify: () => verifyAgentPayment(client as unknown as PublicClient, hash, view.request) };
}

describe("Independent Arc receipt verification", () => {
  it("decodes the official USDC Transfer event and block timestamp", async () => {
    const f = setup();
    await expect(f.verify()).resolves.toEqual(proof);
    expect(f.client.getChainId).toHaveBeenCalledOnce();
    expect(f.client.getBlock).toHaveBeenCalledWith({ blockHash: f.receipt.blockHash });
  });

  it("rejects a wrong RPC network before looking for payment", async () => {
    const f = setup();
    f.client.getChainId.mockResolvedValue(1);
    await expect(f.verify()).rejects.toThrow("network");
    expect(f.client.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects a receipt for another hash or token and a reverted transaction", async () => {
    const f = setup();
    f.client.waitForTransactionReceipt.mockResolvedValueOnce({ ...f.receipt, transactionHash: `0x${"c".repeat(64)}` });
    await expect(f.verify()).rejects.toThrow("different transaction");
    f.client.waitForTransactionReceipt.mockResolvedValueOnce({ ...f.receipt, logs: f.receipt.logs.map((log) => ({ ...log, address: buyer })) });
    await expect(f.verify()).rejects.toThrow("No matching Arc USDC");
    f.client.waitForTransactionReceipt.mockResolvedValueOnce({ ...f.receipt, status: "reverted" });
    await expect(f.verify()).rejects.toThrow("failed");
    expect(f.client.getBlock).not.toHaveBeenCalled();
  });
});
