import { describe, expect, it } from "vitest";
import { decryptClaimBackup, encryptClaimBackup, recoveryManagementToken, walletlessRecoveryMessage } from "./walletless-recovery";
import { ARC_CHAIN_ID, ARC_NETWORK_NAME } from "./arc";
import { ARC_PAYLINK_FACTORY } from "./claim-package";
import type { PrivateClaimPackage } from "./claim-package";
import { keccak256 } from "viem";

const context = {
  sender: `0x${"11".repeat(20)}` as const,
  factory: ARC_PAYLINK_FACTORY,
  paymentId: `0x${"33".repeat(32)}` as const,
  escrow: `0x${"44".repeat(20)}` as const,
};
const claim: PrivateClaimPackage = {
  network: ARC_NETWORK_NAME,
  chainId: ARC_CHAIN_ID,
  factory: context.factory,
  paymentId: context.paymentId,
  escrow: context.escrow,
  amountBaseUnits: "10000",
  amountUsdc: "0.01",
  expiry: "2026-10-20T00:00:00.000Z",
  secretHash: keccak256(`0x${"66".repeat(32)}`),
  secret: `0x${"66".repeat(32)}` as const,
  title: "Design delivery",
  reference: "INV-44",
  recipientEmail: "recipient@example.com",
};
const signature = `0x${"77".repeat(65)}` as const;

describe("encrypted creator recovery", () => {
  it("round-trips the private claim without placing the secret in ciphertext text", async () => {
    const backup = await encryptClaimBackup(claim, signature, context);
    expect(JSON.stringify(backup)).not.toContain(claim.secret.slice(2));
    await expect(decryptClaimBackup(backup, signature, context)).resolves.toEqual(claim);
  });

  it("rejects a different signature and a backup copied to another payment", async () => {
    const backup = await encryptClaimBackup(claim, signature, context);
    await expect(decryptClaimBackup(backup, `0x${"88".repeat(65)}`, context)).rejects.toThrow("does not unlock");
    await expect(decryptClaimBackup(backup, signature, { ...context, paymentId: `0x${"99".repeat(32)}` })).rejects.toThrow("does not unlock");
  });

  it("builds a stable human-readable signature request", () => {
    const message = walletlessRecoveryMessage(context);
    expect(walletlessRecoveryMessage(context)).toBe(message);
    expect(message).toContain(context.paymentId);
    expect(message).toContain("cannot move funds");
    expect(recoveryManagementToken(signature)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
