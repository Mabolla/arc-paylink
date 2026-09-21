export type WalletlessStatus = "awaiting funds" | "partially funded" | "funded" | "expired" | "claimed" | "refunded" | "unavailable";

export function walletlessStatus(state: number | null, expiry: string, escrowBalance: bigint | null, now = Date.now()): WalletlessStatus {
  if (state === 0) {
    if (now >= Date.parse(expiry)) return "expired";
    return escrowBalance && escrowBalance > 0n ? "partially funded" : "awaiting funds";
  }
  if (state === 1) return now >= Date.parse(expiry) ? "expired" : "funded";
  if (state === 2) return "claimed";
  if (state === 3) return "refunded";
  return "unavailable";
}

export function outstandingFunding(target: bigint, current: bigint) {
  if (target <= 0n || current < 0n) throw new Error("Escrow funding values are invalid.");
  return target > current ? target - current : 0n;
}
