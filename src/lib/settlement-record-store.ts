import type { SettlementCorrelationRecord } from "./settlement-correlation";

const PREFIX = "arc-paylink.settlement.v1.";

export type StoreResult = "created" | "unchanged" | "conflict";
export type SharedStoreResult = StoreResult | "not-configured" | "unavailable";

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

export async function saveSettlementRecordOnServer(record: SettlementCorrelationRecord): Promise<SharedStoreResult> {
  try {
    const response = await fetch("/api/settlements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    const result = (await response.json()) as { state?: string };
    if (response.status === 503 && result.state === "not-configured") return "not-configured";
    if (["created", "unchanged", "conflict"].includes(result.state ?? "")) return result.state as StoreResult;
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
