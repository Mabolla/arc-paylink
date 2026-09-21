import { publicClaimContext } from "@/lib/claim-package";
import type { WalletlessPayLinkReference } from "@/lib/walletless-paylink-client";
import { walletlessRegistrationMessage } from "@/lib/walletless-registration";
import type { Address, Hash, WalletClient } from "viem";
import { encryptClaimBackup, recoveryManagementToken, walletlessRecoveryMessage } from "@/lib/walletless-recovery";

type RegistrationWallet = Pick<WalletClient, "signMessage">;

export async function registerWalletlessPayLink(input: {
  item: WalletlessPayLinkReference & { fundingHash: Hash };
  account: Address;
  wallet: RegistrationWallet;
  fetcher?: typeof fetch;
}) {
  const { item, account, wallet, fetcher = fetch } = input;
  const registrationIssuedAt = new Date().toISOString();
  const registrationSignature = await wallet.signMessage({
    account,
    message: walletlessRegistrationMessage({
      sender: account,
      factory: item.claimPackage.factory,
      paymentId: item.claimPackage.paymentId,
      escrow: item.claimPackage.escrow,
      recipientEmail: item.recipientEmail,
      issuedAt: registrationIssuedAt,
    }),
  });
  const recoveryContext = {
    sender: account,
    factory: item.claimPackage.factory,
    paymentId: item.claimPackage.paymentId,
    escrow: item.claimPackage.escrow,
  };
  const recoverySignature = await wallet.signMessage({ account, message: walletlessRecoveryMessage(recoveryContext) });
  const managementToken = recoveryManagementToken(recoverySignature);
  const encryptedClaimBackup = await encryptClaimBackup(item.claimPackage, recoverySignature, recoveryContext);
  const response = await fetcher("/api/walletless", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...publicClaimContext(item.claimPackage),
      sender: account,
      recipientEmail: item.recipientEmail,
      title: item.claimPackage.title,
      reference: item.claimPackage.reference,
      amountUsdc: item.claimPackage.amountUsdc,
      creationHash: item.creationHash,
      fundingHash: item.fundingHash,
      registrationIssuedAt,
      registrationSignature,
      managementToken,
      encryptedClaimBackup,
    }),
  });
  const result = await response.json() as { managementToken?: string; error?: string };
  if (!response.ok && /already registered/i.test(result.error ?? "")) {
    const recoveryResponse = await fetcher(`/api/walletless/${encodeURIComponent(item.claimPackage.paymentId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ managementToken }),
    });
    if (recoveryResponse.ok) return managementToken;
  }
  if (!response.ok || !result.managementToken) {
    throw new Error(result.error ?? "Creator registration failed.");
  }
  if (result.managementToken !== managementToken) throw new Error("Creator recovery token mismatch.");
  return managementToken;
}
