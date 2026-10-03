import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLedger } from "./audit";

const directories: string[] = [];
async function ledgerForTest() {
  const directory = await mkdtemp(join(tmpdir(), "arc-paylink-agentops-test-"));
  directories.push(directory);
  return { ledger: new AuditLedger(join(directory, "audit.jsonl")), path: join(directory, "audit.jsonl") };
}

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("AgentOps audit ledger", () => {
  it("chains and verifies decision and payment evidence", async () => {
    const { ledger } = await ledgerForTest();
    await ledger.append({ event: "decision", at: "2026-10-01T10:00:00.000Z", requestId: "r1", invoiceId: "INV-1", amount: "5", recipient: "0x1", details: { outcome: "payable" } });
    await ledger.append({ event: "payment_started", at: "2026-10-01T10:01:00.000Z", requestId: "r1", invoiceId: "INV-1", amount: "5", recipient: "0x1", details: { amountBaseUnits: "5000000" } });
    await ledger.append({ event: "payment_verified", at: "2026-10-01T10:02:00.000Z", requestId: "r1", invoiceId: "INV-1", amount: "5", recipient: "0x1", details: { amountBaseUnits: "5000000", transactionHash: "0xabc" } });
    expect((await ledger.read()).map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(await ledger.hasInvoice("inv-1")).toBe(true);
    expect(await ledger.spentSince(new Date("2026-10-01T00:00:00.000Z"))).toBe(5_000_000n);
  });

  it("detects edits to a prior audit entry", async () => {
    const { ledger, path } = await ledgerForTest();
    await ledger.append({ event: "decision", at: "2026-10-01T10:00:00.000Z", requestId: "r1", invoiceId: "INV-1", amount: "5", recipient: "0x1", details: { outcome: "payable" } });
    const row = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    row.amount = "5000";
    await writeFile(path, `${JSON.stringify(row)}\n`);
    await expect(ledger.read()).rejects.toThrow("integrity check failed");
  });

  it("treats an ambiguous submitted invoice as already attempted", async () => {
    const { ledger } = await ledgerForTest();
    await ledger.append({ event: "payment_started", at: "2026-10-01T10:00:00.000Z", requestId: "r1", invoiceId: "INV-1", amount: "5", recipient: "0x1", details: {} });
    expect(await ledger.hasInvoice("INV-1")).toBe(true);
  });
});
