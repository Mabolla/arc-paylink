import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { readDeploymentReceipt } = require("../scripts/lib/read-deployment-receipt.cjs");
const { TransactionReceiptNotFoundError } = require("viem");
const hash = `0x${"1".repeat(64)}`;

describe("historical deployment receipt verification input", () => {
  it("recovers a transient missing receipt without changing the returned evidence", async () => {
    const receipt = { status: "success", blockNumber: 21876743n, contractAddress: "factory" };
    const getTransactionReceipt = vi.fn()
      .mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash }))
      .mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash }))
      .mockResolvedValue(receipt);
    const wait = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(readDeploymentReceipt({ getTransactionReceipt }, hash, { wait, onRetry }))
      .resolves.toBe(receipt);
    expect(getTransactionReceipt.mock.calls).toEqual([[{ hash }], [{ hash }], [{ hash }]]);
    expect(wait.mock.calls).toEqual([[1000], [2000]]);
    expect(onRetry.mock.calls).toEqual([
      [{ attempt: 2, delayMs: 1000 }],
      [{ attempt: 3, delayMs: 2000 }],
    ]);
  });

  it("fails after four attempts when the receipt remains missing", async () => {
    const error = new TransactionReceiptNotFoundError({ hash });
    const getTransactionReceipt = vi.fn().mockRejectedValue(error);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(readDeploymentReceipt({ getTransactionReceipt }, hash, { wait })).rejects.toBe(error);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(4);
    expect(wait.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  it("fails immediately on a different error", async () => {
    const error = new Error("unexpected RPC response");
    const getTransactionReceipt = vi.fn().mockRejectedValue(error);
    const wait = vi.fn();

    await expect(readDeploymentReceipt({ getTransactionReceipt }, hash, { wait })).rejects.toBe(error);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
