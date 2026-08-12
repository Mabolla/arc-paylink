import { describe, expect, it } from "vitest";
import { createPaymentRequest, requestToSearchParams } from "./payment-request";

describe("payment requests", () => {
  it("creates a normalized shareable request", () => {
    const request = createPaymentRequest({ title: "  Design work ", amount: "10.500000", recipient: "0x0000000000000000000000000000000000000001" });
    expect(request).toEqual({ title: "Design work", amount: "10.5", recipient: "0x0000000000000000000000000000000000000001" });
    expect(requestToSearchParams(request).get("amount")).toBe("10.5");
  });
  it("rejects invalid recipients", () => expect(() => createPaymentRequest({ title: "Work", amount: "1", recipient: "nope" })).toThrow());
});
