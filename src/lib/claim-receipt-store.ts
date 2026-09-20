import { isAddress, type Hash } from "viem";

export type ConfirmedClaimReceipt = {
  transactionHash: Hash;
  recipient: string;
  escrow: string;
  amountUsdc: string;
  amountBaseUnits: string;
  confirmedAt: string;
};

export function parseConfirmedClaimReceipt(value: string | null): ConfirmedClaimReceipt | null {
  if (!value) return null;
  try {
    const receipt = JSON.parse(value) as Partial<ConfirmedClaimReceipt>;
    if (
      typeof receipt.transactionHash !== "string"
      || !/^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash)
      || typeof receipt.recipient !== "string"
      || !isAddress(receipt.recipient)
      || typeof receipt.escrow !== "string"
      || !isAddress(receipt.escrow)
      || typeof receipt.amountUsdc !== "string"
      || !receipt.amountUsdc
      || typeof receipt.amountBaseUnits !== "string"
      || !/^\d+$/.test(receipt.amountBaseUnits)
      || typeof receipt.confirmedAt !== "string"
      || !Number.isFinite(Date.parse(receipt.confirmedAt))
    ) return null;
    return receipt as ConfirmedClaimReceipt;
  } catch {
    return null;
  }
}

function prefix(network: "mainnet" | "testnet") {
  return `arc-paylink.${network}.confirmed-claim`;
}

function receiptKey(network: "mainnet" | "testnet", escrow: string) {
  return `${prefix(network)}.${escrow.toLowerCase()}`;
}

function pointerKey(network: "mainnet" | "testnet") {
  return `${prefix(network)}.last`;
}

export function saveConfirmedClaimReceipt(storage: Storage, network: "mainnet" | "testnet", receipt: ConfirmedClaimReceipt) {
  storage.setItem(receiptKey(network, receipt.escrow), JSON.stringify(receipt));
  storage.setItem(pointerKey(network), receipt.escrow.toLowerCase());
}

export function loadConfirmedClaimReceipt(storage: Storage, network: "mainnet" | "testnet", escrow?: string) {
  const target = escrow?.toLowerCase() ?? storage.getItem(pointerKey(network));
  if (!target || !isAddress(target)) return null;
  return parseConfirmedClaimReceipt(storage.getItem(receiptKey(network, target)));
}

export function removeConfirmedClaimReceipt(storage: Storage, network: "mainnet" | "testnet", escrow: string) {
  storage.removeItem(receiptKey(network, escrow));
  if (storage.getItem(pointerKey(network))?.toLowerCase() === escrow.toLowerCase()) storage.removeItem(pointerKey(network));
}
