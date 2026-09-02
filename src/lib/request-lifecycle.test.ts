import { describe, expect, it } from "vitest";
import { assertPending, authorizeRequest, createManagedRequest, requestView } from "./request-lifecycle";

const token = "11111111-1111-4111-8111-111111111111";
const base = () => createManagedRequest({ requestId: "22222222-2222-4222-8222-222222222222", managementToken: token, createdAt: "2026-09-02T12:00:00.000Z", title: "Work", amount: "1", recipient: "0x0000000000000000000000000000000000000001", obligationKind: "invoice", obligationId: "INV-1" });

describe("request lifecycle", () => {
  it("stores only a capability hash and starts pending", () => {
    const record = base();
    expect(JSON.stringify(record)).not.toContain(token);
    expect(requestView(record, []).status).toBe("pending");
    expect(() => authorizeRequest(record, token)).not.toThrow();
    expect(() => authorizeRequest(record, "33333333-3333-4333-8333-333333333333")).toThrow("not found");
  });
  it("makes settlement dominant and immutable", () => {
    const view = requestView(base(), [{ type: "revoked", createdAt: "2026-09-02T12:01:00.000Z" }, { type: "settled", createdAt: "2026-09-02T12:02:00.000Z", transactionHash: `0x${"1".repeat(64)}` }]);
    expect(view.status).toBe("settled");
    expect(() => assertPending(view)).toThrow("immutable");
  });
  it("preserves replacement links", () => {
    const view = requestView(base(), [{ type: "replaced", createdAt: "2026-09-02T12:01:00.000Z", replacementRequestId: "44444444-4444-4444-8444-444444444444" }]);
    expect(view).toMatchObject({ status: "replaced", replacementRequestId: "44444444-4444-4444-8444-444444444444" });
  });
});
