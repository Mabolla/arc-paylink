import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { ARC_PAYLINK_FACTORY } from "./claim-package";
import { saveWalletlessPayLink, walletlessPayLinks } from "./walletless-paylink-client";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const secret = `0x${"11".repeat(32)}` as const;
function reference(paymentByte = "22") {
  return {
    sender: "0x1111111111111111111111111111111111111111" as const,
    recipientEmail: "Recipient@Example.com",
    createdAt: "2026-09-20T12:00:00.000Z",
    creationHash: `0x${"33".repeat(32)}` as const,
    fundingHash: `0x${"44".repeat(32)}` as const,
    claimPackage: {
      network: "Arc Testnet",
      chainId: 5_042_002 as const,
      factory: ARC_PAYLINK_FACTORY,
      paymentId: `0x${paymentByte.repeat(32)}` as `0x${string}`,
      escrow: "0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B" as const,
      amountBaseUnits: "10000",
      amountUsdc: "0.01",
      expiry: "2027-09-20T12:00:00.000Z",
      secretHash: keccak256(secret),
      secret,
      title: "Logo delivery",
      reference: "INV-14",
      recipientEmail: "recipient@example.com",
    },
  };
}

describe("walletless PayLink browser records", () => {
  it("saves a validated creator record and normalizes the email", () => {
    const storage = new MemoryStorage();
    saveWalletlessPayLink(storage, reference());
    expect(walletlessPayLinks(storage)).toMatchObject([{ recipientEmail: "recipient@example.com" }]);
  });

  it("replaces the same payment instead of duplicating it", () => {
    const storage = new MemoryStorage();
    saveWalletlessPayLink(storage, reference());
    saveWalletlessPayLink(storage, { ...reference(), recipientEmail: "new@example.com" });
    expect(walletlessPayLinks(storage)).toHaveLength(1);
    expect(walletlessPayLinks(storage)[0].recipientEmail).toBe("new@example.com");
  });

  it("ignores malformed storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("arc-paylink.testnet.walletless-paylinks.v1", "not-json");
    expect(walletlessPayLinks(storage)).toEqual([]);
  });
});
