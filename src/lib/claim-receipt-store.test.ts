import { describe, expect, it } from "vitest";
import { loadConfirmedClaimReceipt, removeConfirmedClaimReceipt, saveConfirmedClaimReceipt, type ConfirmedClaimReceipt } from "./claim-receipt-store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const receipt = (digit: string): ConfirmedClaimReceipt => ({
  transactionHash: `0x${digit.repeat(64)}`,
  recipient: `0x${"11".repeat(20)}`,
  escrow: `0x${digit.repeat(40)}`,
  amountUsdc: "0.01",
  amountBaseUnits: "10000",
  confirmedAt: "2026-09-20T00:00:00.000Z",
});

describe("claim receipt store", () => {
  it("keeps multiple escrow receipts and restores the latest by default", () => {
    const storage = new MemoryStorage();
    const first = receipt("2");
    const second = receipt("3");
    saveConfirmedClaimReceipt(storage, "mainnet", first);
    saveConfirmedClaimReceipt(storage, "mainnet", second);
    expect(loadConfirmedClaimReceipt(storage, "mainnet", first.escrow)).toEqual(first);
    expect(loadConfirmedClaimReceipt(storage, "mainnet")).toEqual(second);
  });

  it("removes only the selected escrow receipt", () => {
    const storage = new MemoryStorage();
    const first = receipt("2");
    const second = receipt("3");
    saveConfirmedClaimReceipt(storage, "testnet", first);
    saveConfirmedClaimReceipt(storage, "testnet", second);
    removeConfirmedClaimReceipt(storage, "testnet", first.escrow);
    expect(loadConfirmedClaimReceipt(storage, "testnet", first.escrow)).toBeNull();
    expect(loadConfirmedClaimReceipt(storage, "testnet", second.escrow)).toEqual(second);
  });
});
