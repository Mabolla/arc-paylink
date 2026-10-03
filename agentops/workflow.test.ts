import { readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLedger } from "./audit";
import { AgentWorkflow } from "./workflow";
import { buyer, fixture, hash, invoice, otherRequestId, proof, requestId, view } from "./test-fixtures";

const directories: string[] = [];
async function setup() { const f = await fixture(); directories.push(f.directory); return f; }
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("AgentOps payment lifecycle", () => {
  it("reserves durably before transfer, then verifies and synchronizes one payment", async () => {
    const f = await setup();
    f.deps.transfer.mockImplementation(async (_, key) => {
      const rows = (await readFile(f.path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(rows.at(-1)).toMatchObject({ event: "payment_started", details: { idempotencyKey: key, walletAddress: buyer } });
      return { transactionHash: hash };
    });
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "settled", paymentSent: true, transactionHash: hash });
    expect((await f.ledger.read()).map((row) => row.event)).toEqual(["decision", "payment_started", "payment_submitted", "payment_verified", "settlement_synced"]);
    expect(f.deps.transfer).toHaveBeenCalledOnce();
    expect(f.deps.sync).toHaveBeenCalledWith(requestId, hash);
  });

  it("does not transfer on declined approval or changed request facts during approval", async () => {
    const f = await setup();
    f.deps.approve.mockResolvedValueOnce(false);
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "declined", paymentSent: false });
    f.deps.load.mockResolvedValueOnce(view).mockResolvedValueOnce({ ...view, request: { ...view.request, amount: "6" } });
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "blocked", paymentSent: false });
    expect(f.deps.transfer).not.toHaveBeenCalled();
  });

  it("prevents two instances using the same ledger from sending concurrently", async () => {
    const f = await setup();
    let release!: () => void;
    let ready!: () => void;
    const waiting = new Promise<void>((resolve) => { ready = resolve; });
    const approved = new Promise<void>((resolve) => { release = resolve; });
    f.deps.approve.mockImplementation(async () => { ready(); await approved; return true; });
    const first = f.workflow.pay(requestId, invoice);
    await waiting;
    const second = new AgentWorkflow({ ...f.deps, ledger: new AuditLedger(f.path) });
    const blocked = await second.pay(requestId, { ...invoice, invoiceId: "another-alias" });
    expect(blocked).toMatchObject({ state: "blocked", paymentSent: false });
    expect("error" in blocked && blocked.error).toContain("ledger is busy");
    release();
    expect(await first).toMatchObject({ state: "settled" });
    expect(f.deps.transfer).toHaveBeenCalledOnce();
  });

  it("blocks duplicates even when the caller changes invoice and PayLink identifiers", async () => {
    const f = await setup();
    await f.workflow.pay(requestId, invoice);
    expect(await f.workflow.pay(requestId, { ...invoice, invoiceId: "alias-1" })).toMatchObject({ state: "blocked" });
    f.deps.load.mockResolvedValue({ ...view, requestId: otherRequestId });
    expect(await f.workflow.pay(otherRequestId, { ...invoice, invoiceId: "alias-2" })).toMatchObject({ state: "blocked" });
    expect(f.deps.transfer).toHaveBeenCalledOnce();
  });

  it("recovers a persisted hash after a process restart without sending again", async () => {
    const f = await setup();
    f.deps.verify.mockRejectedValueOnce(new Error("RPC timeout"));
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "reconciliation-required", paymentSent: "unknown", transactionHash: hash });
    const restarted = new AgentWorkflow({ ...f.deps, ledger: new AuditLedger(f.path) });
    expect(await restarted.reconcile(requestId)).toMatchObject({ state: "settled", paymentSent: true });
    expect(f.deps.transfer).toHaveBeenCalledOnce();
    expect(f.deps.approve).toHaveBeenCalledOnce();
  });

  it("repairs a failed status write without treating the confirmed payment as unsent", async () => {
    const f = await setup();
    f.deps.sync.mockRejectedValueOnce(new Error("HTTP 503"));
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "sync-required", paymentSent: true, chainVerified: true });
    expect(await f.workflow.reconcile(requestId)).toMatchObject({ state: "settled" });
    expect(f.deps.transfer).toHaveBeenCalledOnce();
    expect(f.deps.sync).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous wallet invocation blocked and reserves budget across midnight", async () => {
    const f = await setup();
    f.deps.transfer.mockRejectedValueOnce(new Error("Wallet timed out"));
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "reconciliation-required", paymentSent: "unknown", transactionHash: null });
    expect(await f.workflow.reconcile(requestId)).toMatchObject({ state: "reconciliation-required", paymentSent: "unknown" });
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "blocked" });
    expect(await f.ledger.spentSince(new Date("2026-10-02T00:00:00Z"))).toBe(5_000_000n);
    expect(f.deps.transfer).toHaveBeenCalledOnce();
    expect(f.deps.sync).not.toHaveBeenCalled();
  });

  it.each([
    { sender: "0x0000000000000000000000000000000000000003" as const },
    { blockTimestamp: proof.blockTimestamp - 10n },
    { amountBaseUnits: 4_000_000n },
    { transactionHash: `0x${"b".repeat(64)}` as const },
  ])("never records invalid proof (case %#)", async (override) => {
    const f = await setup();
    f.deps.verify.mockResolvedValue({ ...proof, ...override });
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "reconciliation-required", chainVerified: false });
    expect(f.deps.sync).not.toHaveBeenCalled();
  });

  it("cannot assign one transfer hash to two different obligations", async () => {
    const f = await setup();
    await f.workflow.pay(requestId, invoice);
    f.deps.load.mockResolvedValue({ ...view, requestId: otherRequestId, request: { ...view.request, obligation: { kind: "invoice", id: "INV-43" } } });
    const second = await f.workflow.pay(otherRequestId, { ...invoice, invoiceId: "INV-43", obligationId: "INV-43" });
    expect(second).toMatchObject({ state: "reconciliation-required", chainVerified: false });
    expect(f.deps.sync).toHaveBeenCalledOnce();
  });

  it("stops before calling the wallet if existing audit evidence has been corrupted", async () => {
    const f = await setup();
    await f.workflow.evaluate(requestId, invoice);
    await writeFile(f.path, (await readFile(f.path, "utf8")).replace('"amount":"5"', '"amount":"500"'));
    expect(await f.workflow.pay(requestId, invoice)).toMatchObject({ state: "blocked", paymentSent: false });
    expect(f.deps.approve).not.toHaveBeenCalled();
    expect(f.deps.transfer).not.toHaveBeenCalled();
  });
});
