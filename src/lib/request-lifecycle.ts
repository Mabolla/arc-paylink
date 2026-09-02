import { keccak256, stringToHex } from "viem";
import { createPaymentRequest, type PaymentRequest } from "./payment-request";

export type RequestStatus = "pending" | "settled" | "revoked" | "replaced";

export type ManagedRequest = {
  schemaVersion: 1;
  requestId: string;
  request: PaymentRequest;
  managementTokenHash: `0x${string}`;
  createdAt: string;
  replacesRequestId?: string;
};

export type RequestEvent =
  | { type: "settled"; createdAt: string; transactionHash: `0x${string}` }
  | { type: "revoked"; createdAt: string }
  | { type: "replaced"; createdAt: string; replacementRequestId: string };

export type RequestView = {
  requestId: string;
  request: PaymentRequest;
  createdAt: string;
  status: RequestStatus;
  transactionHash?: `0x${string}`;
  replacementRequestId?: string;
  replacesRequestId?: string;
};

const ID = /^[0-9a-f-]{36}$/;

export function hashManagementToken(token: string): `0x${string}` {
  if (!ID.test(token)) throw new Error("Invalid management capability.");
  return keccak256(stringToHex(token));
}

export function createManagedRequest(input: {
  requestId: string;
  managementToken: string;
  createdAt: string;
  title: string;
  amount: string;
  recipient: string;
  route?: string;
  obligationKind?: string;
  obligationId?: string;
  replacesRequestId?: string;
}): ManagedRequest {
  if (!ID.test(input.requestId) || !Number.isFinite(Date.parse(input.createdAt))) throw new Error("Invalid request identity.");
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    request: createPaymentRequest(input),
    managementTokenHash: hashManagementToken(input.managementToken),
    createdAt: input.createdAt,
    ...(input.replacesRequestId ? { replacesRequestId: input.replacesRequestId } : {}),
  };
}

export function authorizeRequest(record: ManagedRequest, token: string): void {
  if (hashManagementToken(token) !== record.managementTokenHash) throw new Error("Request not found.");
}

export function requestView(record: ManagedRequest, events: RequestEvent[]): RequestView {
  const settled = events.find((event): event is Extract<RequestEvent, { type: "settled" }> => event.type === "settled");
  const replaced = events.find((event): event is Extract<RequestEvent, { type: "replaced" }> => event.type === "replaced");
  const revoked = events.some((event) => event.type === "revoked");
  const status: RequestStatus = settled ? "settled" : replaced ? "replaced" : revoked ? "revoked" : "pending";
  return {
    requestId: record.requestId,
    request: record.request,
    createdAt: record.createdAt,
    status,
    ...(settled ? { transactionHash: settled.transactionHash } : {}),
    ...(replaced ? { replacementRequestId: replaced.replacementRequestId } : {}),
    ...(record.replacesRequestId ? { replacesRequestId: record.replacesRequestId } : {}),
  };
}

export function assertPending(view: RequestView): void {
  if (view.status === "settled") throw new Error("A settled request is immutable.");
  if (view.status !== "pending") throw new Error("Only a pending request can be changed.");
}
