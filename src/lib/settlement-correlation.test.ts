import { describe, expect, it } from "vitest";
import { buildSettlementCorrelationRecord } from "./settlement-correlation";
import { saveSettlementRecord, settlementRecordJson } from "./settlement-record-store";

const burnHash = `0x${"b".repeat(64)}` as const;
const mintHash = `0x${"c".repeat(64)}` as const;
const bridgeResult = {
  amount: "1",
  token: "USDC",
  state: "success",
  provider: "cctp-v2",
  source: { address: "0x1111111111111111111111111111111111111111", chain: { type: "evm", chainId: 84532 } },
  destination: { address: "0x2222222222222222222222222222222222222222", chain: { type: "evm", chainId: 5042002 } },
  steps: [
    { name: "Burn", state: "success", txHash: burnHash },
    { name: "FetchAttestation", state: "success", data: { message: "0x1234", eventNonce: "77", attestation: "0xabcd", status: "complete" } },
    { name: "Mint", state: "success", txHash: mintHash },
  ],
};
const settlement = {
  paymentState: "fee-adjusted",
  recoveryAction: "record-fee",
  outstandingBaseUnits: 0n,
  obligation: { kind: "invoice", id: "INV-7" },
  state: "verified",
  mintTransactionHash: mintHash,
  blockNumber: 123n,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  token: "0x3600000000000000000000000000000000000000",
  grossAmountBaseUnits: 1_000_000n,
  amountBaseUnits: 999_870n,
  bridgeFeeBaseUnits: 130n,
} as const;

describe("settlement correlation", () => {
  it("binds obligation, burn, attestation, mint, and settlement without retaining raw proof bytes", () => {
    const record = buildSettlementCorrelationRecord({ obligation: { kind: "invoice", id: "INV-7" }, bridgeResult: bridgeResult as never, settlement, observedAt: "2026-08-29T08:00:00.000Z" });
    expect(record).toMatchObject({ source: { burnTransactionHash: burnHash }, cctp: { eventNonce: "77", status: "complete" }, destination: { mintTransactionHash: mintHash }, settlement: { state: "fee-adjusted", bridgeFeeBaseUnits: "130" } });
    expect(record.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(settlementRecordJson(record)).not.toContain("0x1234");
    expect(settlementRecordJson(record)).not.toContain("0xabcd");
  });
  it("rejects missing attestation metadata", () => {
    const incomplete = { ...bridgeResult, steps: [bridgeResult.steps[0], bridgeResult.steps[2]] } as never;
    expect(() => buildSettlementCorrelationRecord({ obligation: { kind: "invoice", id: "INV-7" }, bridgeResult: incomplete, settlement, observedAt: "2026-08-29T08:00:00.000Z" })).toThrow("attestation metadata");
  });
  it("persists once and refuses conflicting mutation", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const record = buildSettlementCorrelationRecord({ obligation: { kind: "invoice", id: "INV-7" }, bridgeResult: bridgeResult as never, settlement, observedAt: "2026-08-29T08:00:00.000Z" });
    expect(saveSettlementRecord(storage, record)).toBe("created");
    expect(saveSettlementRecord(storage, record)).toBe("unchanged");
    expect(saveSettlementRecord(storage, { ...record, cctp: { ...record.cctp, status: "changed" } })).toBe("conflict");
  });
});
