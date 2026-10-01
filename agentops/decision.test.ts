import { describe, expect, it } from "vitest";
import { createAgentPolicy, evaluateInvoice } from "./decision";
import type { RequestView } from "../src/lib/request-lifecycle";

const vendor = "0x00000000000000000000000000000000000000a1";
const buyer = "0x00000000000000000000000000000000000000b2";
const policy = createAgentPolicy({ allowedRecipients: vendor, maxPaymentUsdc: "100", dailyLimitUsdc: "250" });
const view: RequestView = {
  requestId: "3a6f27e8-f6bd-43b2-9921-8b26e8b60890",
  request: { title: "Acme invoice", amount: "25", recipient: vendor as `0x${string}`, route: "arc", chainId: 5042002, obligation: { kind: "invoice", id: "INV-42" } },
  createdAt: "2026-09-20T10:00:00.000Z",
  status: "pending",
};
const invoice = { invoiceId: "INV-42", obligationId: "INV-42", recipient: vendor, amount: "25.00", dueDate: "2026-09-30T00:00:00.000Z" };
const now = new Date("2026-10-01T10:00:00.000Z");

describe("AgentOps invoice decision", () => {
  it("allows a due invoice only when exact Arc PayLink facts and configured policy agree", () => {
    const decision = evaluateInvoice({ view, invoice, policy, now });
    expect(decision.outcome).toBe("payable");
    expect(decision.reasons[0]).toContain("pass.");
  });

  it("routes amount, recipient, and allowlist mismatches to human review", () => {
    const decision = evaluateInvoice({ view, invoice: { ...invoice, amount: "24.99", recipient: buyer }, policy, now });
    expect(decision.outcome).toBe("review");
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "Invoice payee differs from the PayLink recipient.",
      "Payee is not on the business allowlist; a human must vet it before payment.",
      "Invoice amount differs from the exact PayLink amount.",
    ]));
  });

  it("rejects a request for an already processed invoice", () => {
    expect(evaluateInvoice({ view, invoice, policy, now, alreadyProcessed: true }).outcome).toBe("reject");
  });

  it("waits until the invoice due date", () => {
    const futureInvoice = { ...invoice, dueDate: "2026-10-03T00:00:00.000Z" };
    const decision = evaluateInvoice({ view, invoice: futureInvoice, policy, now });
    expect(decision.outcome).toBe("wait");
    expect(decision.reasons.join(" ")).toContain("not due until");
  });

  it("escalates a payment that exceeds the remaining daily budget", () => {
    expect(evaluateInvoice({ view, invoice, policy, now, spentTodayBaseUnits: 230_000_000n }).outcome).toBe("review");
  });

  it("rejects non-invoice or terminal PayLinks", () => {
    expect(evaluateInvoice({ view: { ...view, status: "settled" }, invoice, policy, now }).outcome).toBe("reject");
    expect(evaluateInvoice({ view: { ...view, request: { ...view.request, obligation: { kind: "milestone", id: "INV-42" } } }, invoice, policy, now }).outcome).toBe("reject");
  });

  it("requires an explicit recipient allowlist and coherent limits", () => {
    expect(() => createAgentPolicy({ allowedRecipients: "", maxPaymentUsdc: "10", dailyLimitUsdc: "100" })).toThrow("allowlisted");
    expect(() => createAgentPolicy({ allowedRecipients: vendor, maxPaymentUsdc: "100", dailyLimitUsdc: "50" })).toThrow("at least");
  });
});
