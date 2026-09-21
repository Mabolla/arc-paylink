import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { hashManagementToken } from "./request-lifecycle";
import type { EncryptedClaimBackup } from "./walletless-recovery";

export type WalletlessRecord = {
  schemaVersion: 1;
  factory?: Address;
  paymentId: Hex;
  escrow: Address;
  sender: Address;
  recipientEmail: string;
  title: string;
  reference: string;
  amountBaseUnits: string;
  amountUsdc: string;
  expiry: string;
  secretHash: Hex;
  creationHash: Hex;
  fundingHash: Hex;
  managementTokenHash: Hex;
  createdAt: string;
  encryptedClaimBackup?: EncryptedClaimBackup;
};

function text(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}.`);
  const result = value.trim();
  if (result.length > maximum) throw new Error(`${name} is too long.`);
  return result;
}

function bytes32(value: unknown, name: string) {
  const result = text(value, name, 66);
  if (!isHex(result) || result.length !== 66) throw new Error(`${name} is invalid.`);
  return result as Hex;
}

function encryptedBackup(value: unknown): EncryptedClaimBackup | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Encrypted claim backup is invalid.");
  const backup = value as Partial<EncryptedClaimBackup>;
  if (
    backup.schemaVersion !== 1
    || backup.algorithm !== "AES-GCM-256"
    || typeof backup.iv !== "string"
    || !/^[A-Za-z0-9_-]{16}$/.test(backup.iv)
    || typeof backup.ciphertext !== "string"
    || !/^[A-Za-z0-9_-]{24,28000}$/.test(backup.ciphertext)
  ) throw new Error("Encrypted claim backup is invalid.");
  return backup as EncryptedClaimBackup;
}

export function createWalletlessRecord(input: Record<string, unknown> & { managementToken: string; createdAt: string }): WalletlessRecord {
  const sender = text(input.sender, "sender", 42);
  const escrow = text(input.escrow, "escrow", 42);
  const factory = text(input.factory, "factory", 42);
  if (!isAddress(sender) || !isAddress(escrow) || !isAddress(factory)) throw new Error("Walletless PayLink address is invalid.");
  const recipientEmail = text(input.recipientEmail, "recipientEmail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw new Error("Recipient email is invalid.");
  const amountBaseUnits = text(input.amountBaseUnits, "amountBaseUnits", 80);
  if (!/^\d+$/.test(amountBaseUnits) || BigInt(amountBaseUnits) <= 0n) throw new Error("Claim amount is invalid.");
  const expiry = text(input.expiry, "expiry", 40);
  if (!Number.isFinite(Date.parse(expiry))) throw new Error("Claim expiry is invalid.");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("Creation time is invalid.");
  const backup = encryptedBackup(input.encryptedClaimBackup);
  return {
    schemaVersion: 1,
    factory: getAddress(factory),
    paymentId: bytes32(input.paymentId, "paymentId"),
    escrow: getAddress(escrow),
    sender: getAddress(sender),
    recipientEmail,
    title: text(input.title, "title", 80),
    reference: text(input.reference, "reference", 64),
    amountBaseUnits,
    amountUsdc: text(input.amountUsdc, "amountUsdc", 80),
    expiry,
    secretHash: bytes32(input.secretHash, "secretHash"),
    creationHash: bytes32(input.creationHash, "creationHash"),
    fundingHash: bytes32(input.fundingHash, "fundingHash"),
    managementTokenHash: hashManagementToken(input.managementToken),
    createdAt: input.createdAt,
    ...(backup ? { encryptedClaimBackup: backup } : {}),
  };
}

export function authorizeWalletlessRecord(record: WalletlessRecord, managementToken: string) {
  if (hashManagementToken(managementToken) !== record.managementTokenHash) throw new Error("PayLink not found.");
}

export function walletlessCreatorView(record: WalletlessRecord) {
  return {
    schemaVersion: record.schemaVersion,
    ...(record.factory ? { factory: record.factory } : {}),
    paymentId: record.paymentId,
    escrow: record.escrow,
    sender: record.sender,
    recipientEmail: record.recipientEmail,
    title: record.title,
    reference: record.reference,
    amountBaseUnits: record.amountBaseUnits,
    amountUsdc: record.amountUsdc,
    expiry: record.expiry,
    secretHash: record.secretHash,
    creationHash: record.creationHash,
    fundingHash: record.fundingHash,
    createdAt: record.createdAt,
    ...(record.encryptedClaimBackup ? { encryptedClaimBackup: record.encryptedClaimBackup } : {}),
  };
}
