import { formatUnits, getAddress, isAddress, parseUnits, type Address, type Hash } from "viem";

export type TransferReview = {
  recipient: Address;
  amount: string;
  amountBaseUnits: bigint;
  fromBlock: bigint;
};

export type TransferLog = {
  args: { value?: bigint };
  transactionHash: Hash | null;
};

export type StoredPendingTransfer = {
  walletAddress: Address;
  recipient: Address;
  amountBaseUnits: string;
  fromBlock: string;
};

export function createSubmissionGuard() {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}

export function validateTransferInput(recipient: string, amount: string, balance: bigint) {
  if (!isAddress(recipient)) throw new Error("Enter a valid Arc destination address.");
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(amount.trim())) {
    throw new Error("Enter a valid USDC amount with no more than 6 decimal places.");
  }
  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = parseUnits(amount, 6);
  } catch {
    throw new Error("Enter a valid USDC amount with no more than 6 decimal places.");
  }
  if (amountBaseUnits <= 0n) throw new Error("Amount must be greater than zero.");
  if (amountBaseUnits > balance) throw new Error("Amount exceeds this wallet's USDC balance.");
  return {
    recipient: getAddress(recipient),
    amount: formatUnits(amountBaseUnits, 6),
    amountBaseUnits,
  };
}

export function findMatchingTransferHash(logs: readonly TransferLog[], amountBaseUnits: bigint): Hash | undefined {
  return [...logs].reverse().find((log) => log.args.value === amountBaseUnits)?.transactionHash ?? undefined;
}

export function pendingTransferKey(walletAddress: string) {
  return `arc-paylink.pending-transfer.${walletAddress.toLowerCase()}`;
}

export function serializePendingTransfer(review: TransferReview, walletAddress: Address): string {
  return JSON.stringify({
    walletAddress,
    recipient: review.recipient,
    amountBaseUnits: review.amountBaseUnits.toString(),
    fromBlock: review.fromBlock.toString(),
  } satisfies StoredPendingTransfer);
}

export function parsePendingTransfer(value: string | null, expectedWallet: Address): TransferReview | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredPendingTransfer>;
    if (!parsed.walletAddress || !parsed.recipient || !parsed.amountBaseUnits || !parsed.fromBlock) return null;
    if (!isAddress(parsed.walletAddress) || !isAddress(parsed.recipient)) return null;
    if (getAddress(parsed.walletAddress) !== getAddress(expectedWallet)) return null;
    const amountBaseUnits = BigInt(parsed.amountBaseUnits);
    const fromBlock = BigInt(parsed.fromBlock);
    if (amountBaseUnits <= 0n || fromBlock < 0n) return null;
    return { recipient: getAddress(parsed.recipient), amount: formatUnits(amountBaseUnits, 6), amountBaseUnits, fromBlock };
  } catch {
    return null;
  }
}
