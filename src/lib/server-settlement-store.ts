import { keccak256, stringToHex } from "viem";
import type { SettlementCorrelationRecord } from "./settlement-correlation";
import { settlementRecordJson } from "./settlement-record-store";

export type SharedStoreResult = "created" | "unchanged" | "conflict";

export type SettlementBlobStore = {
  list(prefix: string): Promise<string[]>;
  put(pathname: string, body: string): Promise<void>;
};

export type SettlementBlobReader = {
  list(prefix: string): Promise<string[]>;
  read(pathname: string): Promise<unknown>;
};

export async function persistSettlementRecord(record: SettlementCorrelationRecord, store: SettlementBlobStore): Promise<SharedStoreResult> {
  const body = settlementRecordJson(record);
  const digest = keccak256(stringToHex(body)).slice(2);
  const prefix = `settlements/v1/${record.correlationId}/`;
  const pathname = `${prefix}${digest}.json`;
  const existing = await store.list(prefix);
  if (existing.includes(pathname)) return "unchanged";
  if (existing.length > 0) return "conflict";
  try {
    await store.put(pathname, body);
  } catch (error) {
    const raced = await store.list(prefix);
    if (raced.includes(pathname)) return "unchanged";
    if (raced.length > 0) return "conflict";
    throw error;
  }
  return "created";
}

export async function findSettlementRecord(
  correlationId: string,
  obligation: SettlementCorrelationRecord["obligation"],
  store: SettlementBlobReader,
): Promise<SettlementCorrelationRecord | "not-found" | "conflict"> {
  const prefix = `settlements/v1/${correlationId.toLowerCase()}/`;
  const matches = await store.list(prefix);
  if (matches.length === 0) return "not-found";
  if (matches.length !== 1) return "conflict";
  const record = await store.read(matches[0]);
  if (!record || typeof record !== "object") return "not-found";
  const candidate = record as SettlementCorrelationRecord;
  if (candidate.correlationId.toLowerCase() !== correlationId.toLowerCase()) return "not-found";
  if (candidate.obligation.kind !== obligation.kind || candidate.obligation.id !== obligation.id) return "not-found";
  return candidate;
}
