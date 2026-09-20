import { getAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { ARC_CHAIN_ID } from "./arc";

export function walletlessRegistrationMessage(input: {
  sender: Address;
  factory: Address;
  paymentId: Hex;
  escrow: Address;
  recipientEmail: string;
  issuedAt: string;
}) {
  const issuedAt = new Date(input.issuedAt);
  if (!Number.isFinite(issuedAt.getTime())) throw new Error("Registration time is invalid.");
  const email = input.recipientEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Recipient email is invalid.");
  const emailHash = keccak256(stringToHex(email));
  // Wallet providers and RPC reads may return the same address with different
  // casing. Canonicalize them so both sides sign identical message bytes.
  const sender = getAddress(input.sender);
  const factory = getAddress(input.factory);
  const escrow = getAddress(input.escrow);
  return [
    "Arc PayLink creator registration",
    `Chain ID: ${ARC_CHAIN_ID}`,
    `Sender: ${sender}`,
    `Factory: ${factory}`,
    `Payment ID: ${input.paymentId}`,
    `Escrow: ${escrow}`,
    `Recipient email hash: ${emailHash}`,
    `Issued at: ${issuedAt.toISOString()}`,
  ].join("\n");
}
