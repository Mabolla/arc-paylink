import type { SettlementCorrelationRecord } from "./settlement-correlation";

const PREFIX = "arc-paylink.settlement.v1.";

export type StoreResult = "created" | "unchanged" | "conflict";

export function saveSettlementRecord(storage: Pick<Storage, "getItem" | "setItem">, record: SettlementCorrelationRecord): StoreResult {
  const key = `${PREFIX}${record.correlationId}`;
  const encoded = JSON.stringify(record);
  const existing = storage.getItem(key);
  if (existing === encoded) return "unchanged";
  if (existing !== null) return "conflict";
  storage.setItem(key, encoded);
  return "created";
}

export function settlementRecordJson(record: SettlementCorrelationRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

