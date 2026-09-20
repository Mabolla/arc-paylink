import { describe, expect, it } from "vitest";
import { getAddress, type Address, type Hash } from "viem";
import {
  findMatchingTransferHash,
  createSubmissionGuard,
  parsePendingTransfer,
  pendingTransferKey,
  serializePendingTransfer,
  validateTransferInput,
  type TransferReview,
} from "./recipient-wallet-transfer";

const wallet = "0x52b3d8d02cc67486e03bbeb5ecea5bc38933e8c2" as Address;
const recipient = "0x94705a9d675daa924f9190eca4c05ed6b12d5345" as Address;
const normalizedRecipient = getAddress(recipient);

describe("recipient wallet transfer safety", () => {
  it("blocks a double approval until the active attempt finishes", () => {
    const guard = createSubmissionGuard();
    expect(guard.acquire()).toBe(true);
    expect(guard.acquire()).toBe(false);
    guard.release();
    expect(guard.acquire()).toBe(true);
  });

  it("normalizes a valid exact USDC transfer", () => {
    expect(validateTransferInput(recipient, "0.010000", 10_000n)).toEqual({ recipient: normalizedRecipient, amount: "0.01", amountBaseUnits: 10_000n });
  });

  it.each(["", "0x123", "not-an-address"])("rejects invalid destination %j", (value) => {
    expect(() => validateTransferInput(value, "0.01", 10_000n)).toThrow("valid Arc destination");
  });

  it.each(["0", "-1"])("rejects non-positive amount %j", (value) => {
    expect(() => validateTransferInput(recipient, value, 10_000n)).toThrow("greater than zero");
  });

  it.each(["abc", "0.0000001"])("rejects malformed USDC amount %j", (value) => {
    expect(() => validateTransferInput(recipient, value, 10_000n)).toThrow("valid USDC amount");
  });

  it("rejects an amount above the onchain balance", () => {
    expect(() => validateTransferInput(recipient, "0.02", 10_000n)).toThrow("exceeds");
  });

  it("selects only the exact matching transfer and prefers the newest log", () => {
    const oldHash = `0x${"1".repeat(64)}` as Hash;
    const exactHash = `0x${"2".repeat(64)}` as Hash;
    expect(findMatchingTransferHash([
      { args: { value: 9_999n }, transactionHash: oldHash },
      { args: { value: 10_000n }, transactionHash: exactHash },
    ], 10_000n)).toBe(exactHash);
    expect(findMatchingTransferHash([{ args: { value: 9_999n }, transactionHash: oldHash }], 10_000n)).toBeUndefined();
  });

  it("round-trips pending confirmation state across a page refresh", () => {
    const review: TransferReview = { recipient: normalizedRecipient, amount: "0.01", amountBaseUnits: 10_000n, fromBlock: 123n };
    expect(parsePendingTransfer(serializePendingTransfer(review, wallet), wallet)).toEqual(review);
    expect(pendingTransferKey(wallet)).toContain(wallet.toLowerCase());
  });

  it("ignores corrupt or cross-wallet pending state", () => {
    const review: TransferReview = { recipient: normalizedRecipient, amount: "0.01", amountBaseUnits: 10_000n, fromBlock: 123n };
    const other = "0x0000000000000000000000000000000000000001" as Address;
    expect(parsePendingTransfer("not-json", wallet)).toBeNull();
    expect(parsePendingTransfer(serializePendingTransfer(review, wallet), other)).toBeNull();
  });
});
