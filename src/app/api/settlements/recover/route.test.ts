import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, list } from "@vercel/blob";
import { buildSettlementCorrelationRecord, type SettlementCorrelationRecord } from "@/lib/settlement-correlation";
import type { RecoveryAction, SettlementState } from "@/lib/settlement-state";
import { POST } from "./route";

vi.mock("@vercel/blob", () => ({ get: vi.fn(), list: vi.fn() }));

const mockedList = vi.mocked(list);
const mockedGet = vi.mocked(get);
const burn = `0x${"1".repeat(64)}` as const;
const wrongBurn = `0x${"f".repeat(64)}` as const;

function record(state: SettlementState, recoveryAction: RecoveryAction, outstandingBaseUnits = 0n): SettlementCorrelationRecord {
  return buildSettlementCorrelationRecord({
    obligation: { kind: "invoice", id: "INV-RECOVERY-7" },
    bridgeResult: {
      source: { chain: { type: "evm", chainId: 84532 } },
      destination: { chain: { type: "evm", chainId: 5042002 } },
      steps: [
        { name: "burn", txHash: burn },
        { name: "attestation", data: { eventNonce: "77", message: "0x1234", attestation: "0xabcd", status: "complete" } },
        { name: "mint", txHash: `0x${"2".repeat(64)}` },
      ],
    } as never,
    settlement: {
      paymentState: state,
      recoveryAction,
      grossAmountBaseUnits: 1_000_000n,
      amountBaseUnits: 1_000_000n - outstandingBaseUnits,
      bridgeFeeBaseUnits: 0n,
      outstandingBaseUnits,
      blockNumber: 99n,
    } as never,
    observedAt: "2026-08-29T12:00:00.000Z",
  });
}

function request(value: SettlementCorrelationRecord, paymentReference = burn) {
  return new Request("http://localhost/api/settlements/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      correlationId: value.correlationId,
      obligationKind: value.obligation.kind,
      obligationId: value.obligation.id,
      paymentReference,
    }),
  });
}

function serve(value: SettlementCorrelationRecord) {
  mockedList.mockResolvedValue({ blobs: [{ pathname: `settlements/v1/${value.correlationId}/digest.json` }] } as never);
  mockedGet.mockResolvedValue({ statusCode: 200, stream: new Response(JSON.stringify(value)).body } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

describe("POST /api/settlements/recover", () => {
  it("returns no-action for an already settled record", async () => {
    const value = record("settled", "none");
    serve(value);
    const response = await POST(request(value));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ state: "no-action", plan: { action: "none", fundMovement: false, executable: false } });
  });

  it("does not disclose a record when the payment reference is wrong", async () => {
    const value = record("pending", "await-destination", 1_000_000n);
    serve(value);
    const response = await POST(request(value, wrongBurn));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ state: "not-found" });
  });

  it("preserves conflicting immutable records for manual investigation", async () => {
    const value = record("partial", "request-top-up", 100_000n);
    mockedList.mockResolvedValue({ blobs: [{ pathname: "one" }, { pathname: "two" }] } as never);
    const response = await POST(request(value));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ state: "conflict" });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("returns the exact outstanding amount for a partial settlement", async () => {
    const value = record("partial", "request-top-up", 100_000n);
    serve(value);
    const response = await POST(request(value));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ state: "ready", plan: { action: "request-top-up", outstandingBaseUnits: "100000", fundMovement: false } });
  });

  it("routes a mismatched settlement to manual review", async () => {
    const value = record("mismatched", "manual-review", 1_000_000n);
    serve(value);
    const response = await POST(request(value));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ state: "manual-review", plan: { action: "manual-review", executable: false } });
  });

  it("returns the same deterministic plan for repeated recovery requests", async () => {
    const value = record("pending", "await-destination", 1_000_000n);
    serve(value);
    const first = await (await POST(request(value))).json();
    serve(value);
    const second = await (await POST(request(value))).json();
    expect(second.plan.planId).toBe(first.plan.planId);
    expect(second.plan).toEqual(first.plan);
  });
});
