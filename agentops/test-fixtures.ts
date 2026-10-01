import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { ARC_CHAIN_ID } from "../src/lib/arc";
import type { RequestView } from "../src/lib/request-lifecycle";
import { AuditLedger } from "./audit";
import { createAgentPolicy } from "./decision";
import { AgentWorkflow, type AgentDependencies, type VerifiedPayment } from "./workflow";

export const vendor = "0x0000000000000000000000000000000000000001" as const;
export const buyer = "0x0000000000000000000000000000000000000002" as const;
export const requestId = "3a6f27e8-f6bd-43b2-9921-8b26e8b60890";
export const otherRequestId = "4a6f27e8-f6bd-43b2-9921-8b26e8b60890";
export const hash = `0x${"a".repeat(64)}` as const;
export const now = new Date("2026-10-01T10:00:00.000Z");
export const view: RequestView = {
  requestId, request: { title: "Invoice 42", amount: "5", recipient: vendor, route: "arc", chainId: ARC_CHAIN_ID, obligation: { kind: "invoice", id: "INV-42" } },
  createdAt: "2026-09-20T10:00:00.000Z", status: "pending",
};
export const invoice = { invoiceId: "INV-42", obligationId: "INV-42", recipient: vendor, amount: "5.00", dueDate: "2026-09-30T00:00:00.000Z" };
export const proof: VerifiedPayment = {
  sender: buyer, recipient: vendor, amountBaseUnits: 5_000_000n,
  transactionHash: hash, blockNumber: 123n, blockTimestamp: BigInt(Math.floor(now.getTime() / 1000) + 2),
};

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "arc-paylink-workflow-test-"));
  const path = join(directory, "audit.jsonl");
  const ledger = new AuditLedger(path);
  const deps = {
    ledger, walletAddress: buyer,
    now: () => now,
    policy: () => createAgentPolicy({ allowedRecipients: vendor, maxPaymentUsdc: "5", dailyLimitUsdc: "10" }),
    load: vi.fn<AgentDependencies["load"]>().mockResolvedValue(structuredClone(view)),
    approve: vi.fn<AgentDependencies["approve"]>().mockResolvedValue(true),
    transfer: vi.fn<AgentDependencies["transfer"]>().mockResolvedValue({ transactionHash: hash }),
    verify: vi.fn<AgentDependencies["verify"]>().mockResolvedValue(proof),
    sync: vi.fn<AgentDependencies["sync"]>().mockResolvedValue({ ...view, status: "settled", transactionHash: hash }),
  };
  return { directory, path, ledger, deps, workflow: new AgentWorkflow(deps) };
}
