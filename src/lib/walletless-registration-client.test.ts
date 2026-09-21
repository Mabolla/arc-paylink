import { describe, expect, it, vi } from "vitest";
import { registerWalletlessPayLink } from "./walletless-registration-client";
import type { WalletlessPayLinkReference } from "./walletless-paylink-client";
import { ARC_CHAIN_ID, ARC_NETWORK_NAME } from "./arc";
import { ARC_PAYLINK_FACTORY } from "./claim-package";
import { recoveryManagementToken } from "./walletless-recovery";
import { keccak256 } from "viem";

const signature = `0x${"99".repeat(65)}` as const;
const expectedManagementToken = recoveryManagementToken(signature);

const item: WalletlessPayLinkReference & { fundingHash: `0x${string}` } = {
  sender: `0x${"11".repeat(20)}` as const,
  recipientEmail: "recipient@example.com",
  createdAt: "2026-09-20T00:00:00.000Z",
  creationHash: `0x${"22".repeat(32)}` as const,
  fundingHash: `0x${"33".repeat(32)}` as const,
  claimPackage: {
    network: ARC_NETWORK_NAME,
    chainId: ARC_CHAIN_ID,
    factory: ARC_PAYLINK_FACTORY,
    paymentId: `0x${"55".repeat(32)}` as const,
    escrow: `0x${"66".repeat(20)}` as const,
    amountBaseUnits: "10000",
    amountUsdc: "0.01",
    expiry: "2026-09-27T00:00:00.000Z",
    secretHash: keccak256(`0x${"88".repeat(32)}`),
    secret: `0x${"88".repeat(32)}` as const,
    title: "Invoice",
    reference: "INV-1",
    recipientEmail: "recipient@example.com",
  },
};

describe("walletless registration client", () => {
  it("signs the sender-bound record and never uploads the claim secret", async () => {
    const signMessage = vi.fn().mockResolvedValue(signature);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ managementToken: expectedManagementToken }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    await expect(registerWalletlessPayLink({ item, account: item.sender, wallet: { signMessage } as never, fetcher })).resolves.toBe(expectedManagementToken);
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.secret).toBeUndefined();
    expect(JSON.stringify(request.encryptedClaimBackup)).not.toContain(item.claimPackage.secret.slice(2));
    expect(request.secretHash).toBe(item.claimPackage.secretHash);
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it("surfaces an API registration error", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "registration unavailable" }), { status: 503 }));
    await expect(registerWalletlessPayLink({
      item,
      account: item.sender,
      wallet: { signMessage: vi.fn().mockResolvedValue(signature) } as never,
      fetcher,
    })).rejects.toThrow("registration unavailable");
  });

  it("recovers deterministically when registration succeeded but its response was lost", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "This PayLink is already registered." }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ view: { paymentId: item.claimPackage.paymentId } }), { status: 200 }));
    await expect(registerWalletlessPayLink({
      item,
      account: item.sender,
      wallet: { signMessage: vi.fn().mockResolvedValue(signature) } as never,
      fetcher,
    })).resolves.toBe(expectedManagementToken);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
