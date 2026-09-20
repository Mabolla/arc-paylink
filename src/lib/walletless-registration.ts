import { keccak256, stringToHex, type Address, type Hex } from "viem";
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
  return [
    "Arc PayLink creator registration",
    `Chain ID: ${ARC_CHAIN_ID}`,
    `Sender: ${input.sender}`,
    `Factory: ${input.factory}`,
    `Payment ID: ${input.paymentId}`,
    `Escrow: ${input.escrow}`,
    `Recipient email hash: ${emailHash}`,
    `Issued at: ${issuedAt.toISOString()}`,
  ].join("\n");
}
