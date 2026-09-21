import { ARC_CHAIN_ID } from "./arc";
import { parsePrivateClaimPackage, type PrivateClaimPackage } from "./claim-package";
import { getAddress, hexToBytes, isHex, keccak256, type Address, type Hex } from "viem";

export type EncryptedClaimBackup = {
  schemaVersion: 1;
  algorithm: "AES-GCM-256";
  iv: string;
  ciphertext: string;
};

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Encrypted backup encoding is invalid.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function recoveryContext(input: { sender: Address; factory: Address; paymentId: Hex; escrow: Address }) {
  // Wallet providers commonly return the connected account in lowercase while
  // persisted records use checksum casing. Keep the sender lowercase for
  // compatibility with existing backups, and canonicalize claim addresses.
  const sender = input.sender.toLowerCase();
  const factory = getAddress(input.factory);
  const escrow = getAddress(input.escrow);
  return [
    "Arc PayLink creator recovery",
    `Chain ID: ${ARC_CHAIN_ID}`,
    `Sender: ${sender}`,
    `Factory: ${factory}`,
    `Payment ID: ${input.paymentId}`,
    `Escrow: ${escrow}`,
    "Purpose: decrypt this PayLink creator backup; this signature cannot move funds.",
  ].join("\n");
}

export function walletlessRecoveryMessage(input: { sender: Address; factory: Address; paymentId: Hex; escrow: Address }) {
  return recoveryContext(input);
}

export function recoveryManagementToken(signature: Hex) {
  if (!isHex(signature) || signature.length !== 132) throw new Error("Creator recovery signature is invalid.");
  return keccak256(signature);
}

async function recoveryKey(signature: Hex, context: string) {
  if (!isHex(signature) || signature.length !== 132) throw new Error("Creator recovery signature is invalid.");
  const domain = new TextEncoder().encode(`${context}\nEncryption: AES-GCM-256\n`);
  const signatureBytes = hexToBytes(signature);
  const material = new Uint8Array(domain.length + signatureBytes.length);
  material.set(domain);
  material.set(signatureBytes, domain.length);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptClaimBackup(
  claimPackage: PrivateClaimPackage,
  recoverySignature: Hex,
  context: { sender: Address; factory: Address; paymentId: Hex; escrow: Address },
): Promise<EncryptedClaimBackup> {
  const parsed = parsePrivateClaimPackage(claimPackage);
  const associatedData = new TextEncoder().encode(recoveryContext(context));
  const plaintext = new TextEncoder().encode(JSON.stringify(parsed));
  if (plaintext.byteLength > 16 * 1024) throw new Error("Claim backup is too large.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recoveryKey(recoverySignature, recoveryContext(context));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData }, key, plaintext);
  return { schemaVersion: 1, algorithm: "AES-GCM-256", iv: base64Url(iv), ciphertext: base64Url(new Uint8Array(ciphertext)) };
}

export async function decryptClaimBackup(
  backup: EncryptedClaimBackup,
  recoverySignature: Hex,
  context: { sender: Address; factory: Address; paymentId: Hex; escrow: Address },
) {
  if (backup?.schemaVersion !== 1 || backup.algorithm !== "AES-GCM-256") throw new Error("Encrypted backup format is unsupported.");
  const iv = fromBase64Url(backup.iv);
  const ciphertext = fromBase64Url(backup.ciphertext);
  if (iv.byteLength !== 12 || ciphertext.byteLength < 17 || ciphertext.byteLength > 20 * 1024) throw new Error("Encrypted backup is invalid.");
  try {
    const associatedData = new TextEncoder().encode(recoveryContext(context));
    const key = await recoveryKey(recoverySignature, recoveryContext(context));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: associatedData }, key, ciphertext);
    return parsePrivateClaimPackage(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error("Creator recovery signature does not unlock this PayLink backup.");
  }
}
