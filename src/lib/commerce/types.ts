export type Workspace = {
  id: string;
  name: string;
  recipient: `0x${string}`;
  chainId: number;
  createdAt: string;
};
export type AccessKey = {
  id: string;
  merchantId: string;
  hash: string;
  role: "owner" | "reader";
  name: string;
  createdAt: string;
  revokedAt?: string;
  pendingOwnerHash?: string;
  pendingOwnerExpiresAt?: string;
  rotatedAt?: string;
};
export type Principal = { workspace: Workspace; key: AccessKey };
export type Order = {
  id: string;
  merchantId: string;
  merchantName: string;
  reference: string;
  title: string;
  amount: string;
  recipient: `0x${string}`;
  chainId: number;
  createdAt: string;
  dueAt?: string;
  customerReference: string;
  fingerprint: string;
  status: "pending" | "processing" | "paid" | "cancelled";
  attempt?: {
    provider?: "circle" | "external";
    walletId: string;
    walletAddress: `0x${string}`;
    idempotencyKey: string;
    startedAt: string;
    challengeId?: string;
    externalNonce?: number;
  };
  receipt?: {
    transactionHash: `0x${string}`;
    sender: `0x${string}`;
    blockNumber: string;
    confirmedAt: string;
    confirmationSource?: "circle-webhook" | "customer-reconcile" | "external-wallet";
  };
};
export type PublicOrder = Pick<
  Order,
  | "id"
  | "merchantName"
  | "reference"
  | "title"
  | "amount"
  | "recipient"
  | "chainId"
  | "createdAt"
  | "dueAt"
  | "status"
  | "receipt"
>;
export function publicOrder(order: Order): PublicOrder {
  const {
    id,
    merchantName,
    reference,
    title,
    amount,
    recipient,
    chainId,
    createdAt,
    dueAt,
    status,
    receipt,
  } = order;
  return {
    id,
    merchantName,
    reference,
    title,
    amount,
    recipient,
    chainId,
    createdAt,
    dueAt,
    status,
    receipt,
  };
}
