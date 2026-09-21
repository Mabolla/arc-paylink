import { getAddress, isAddress, isHex, type Address, type Hash } from "viem";
import { ARC_NETWORK } from "./arc";
import { parsePrivateClaimPackage, type PrivateClaimPackage } from "./claim-package";

const STORAGE_KEY = `arc-paylink.${ARC_NETWORK}.walletless-paylinks.v1`;

export type WalletlessPayLinkReference = {
  sender: Address;
  recipientEmail: string;
  createdAt: string;
  creationHash: Hash;
  fundingHash?: Hash;
  claimPackage: PrivateClaimPackage;
  managementToken?: string;
};

function parseReference(value: unknown): WalletlessPayLinkReference | null {
  if (!value || typeof value !== "object") return null;
  try {
    const input = value as Partial<WalletlessPayLinkReference>;
    if (!input.sender || !isAddress(input.sender)) return null;
    if (typeof input.recipientEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipientEmail)) return null;
    if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) return null;
    if (!input.creationHash || !isHex(input.creationHash) || input.creationHash.length !== 66) return null;
    if (input.fundingHash && (!isHex(input.fundingHash) || input.fundingHash.length !== 66)) return null;
    return {
      sender: getAddress(input.sender),
      recipientEmail: input.recipientEmail.trim().toLowerCase(),
      createdAt: input.createdAt,
      creationHash: input.creationHash,
      ...(input.fundingHash ? { fundingHash: input.fundingHash } : {}),
      claimPackage: parsePrivateClaimPackage(input.claimPackage),
      ...(typeof input.managementToken === "string" && (/^[0-9a-f-]{36}$/.test(input.managementToken) || /^0x[0-9a-f]{64}$/.test(input.managementToken))
        ? { managementToken: input.managementToken }
        : {}),
    };
  } catch {
    return null;
  }
}

export function walletlessPayLinks(storage: Storage): WalletlessPayLinkReference[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseReference).filter((item): item is WalletlessPayLinkReference => Boolean(item));
  } catch {
    return [];
  }
}

export function saveWalletlessPayLink(storage: Storage, reference: WalletlessPayLinkReference) {
  const verified = parseReference(reference);
  if (!verified) throw new Error("Could not save the PayLink management record.");
  const existing = walletlessPayLinks(storage).filter(
    (item) => item.claimPackage.paymentId.toLowerCase() !== verified.claimPackage.paymentId.toLowerCase(),
  );
  storage.setItem(STORAGE_KEY, JSON.stringify([verified, ...existing].slice(0, 100)));
}
