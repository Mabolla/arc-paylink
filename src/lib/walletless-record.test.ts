import { describe, expect, it } from "vitest";
import { authorizeWalletlessRecord, createWalletlessRecord, walletlessCreatorView } from "./walletless-record";

const managementToken = "11111111-1111-4111-8111-111111111111";
function input() {
  return {
    managementToken,
    createdAt: "2026-09-20T12:00:00.000Z",
    paymentId: `0x${"22".repeat(32)}`,
    factory: "0x2222222222222222222222222222222222222222",
    escrow: "0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B",
    sender: "0x1111111111111111111111111111111111111111",
    recipientEmail: "Recipient@Example.com",
    title: "Logo delivery",
    reference: "INV-14",
    amountBaseUnits: "10000",
    amountUsdc: "0.01",
    expiry: "2027-09-20T12:00:00.000Z",
    secretHash: `0x${"33".repeat(32)}`,
    creationHash: `0x${"44".repeat(32)}`,
    fundingHash: `0x${"55".repeat(32)}`,
    encryptedClaimBackup: {
      schemaVersion: 1,
      algorithm: "AES-GCM-256",
      iv: "AAAAAAAAAAAAAAAA",
      ciphertext: "BBBBBBBBBBBBBBBBBBBBBBBB",
    },
  };
}

describe("walletless server records", () => {
  it("stores only the management-token hash and normalizes private creator metadata", () => {
    const record = createWalletlessRecord(input());
    expect(record.recipientEmail).toBe("recipient@example.com");
    expect(record.factory).toBe("0x2222222222222222222222222222222222222222");
    expect(JSON.stringify(record)).not.toContain(managementToken);
    expect(walletlessCreatorView(record)).not.toHaveProperty("managementTokenHash");
    expect(walletlessCreatorView(record)).toHaveProperty("encryptedClaimBackup");
  });

  it("requires the exact management capability", () => {
    const record = createWalletlessRecord(input());
    expect(() => authorizeWalletlessRecord(record, managementToken)).not.toThrow();
    expect(() => authorizeWalletlessRecord(record, "22222222-2222-4222-8222-222222222222")).toThrow("not found");
  });

  it("rejects malformed creator metadata", () => {
    expect(() => createWalletlessRecord({ ...input(), recipientEmail: "wrong" })).toThrow("email");
  });
});
