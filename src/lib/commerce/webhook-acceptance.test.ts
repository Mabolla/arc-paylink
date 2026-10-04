import { describe, expect, it } from "vitest";
import { assertAcceptanceDeliveryReady } from "./webhook-acceptance";

const now = Date.parse("2026-10-04T09:00:00Z");
const env = {
  VERCEL_PROJECT_PRODUCTION_URL: "arc-paylink-collections-pilot.vercel.app",
  ARCPAYLINK_ACCEPTANCE_HOLD_ORDER_ID: "test-order",
  ARCPAYLINK_ACCEPTANCE_HOLD_UNTIL: new Date(now + 300_000).toISOString(),
};
describe("isolated pilot notification fault injection", () => {
  it("leaves unconfigured delivery unchanged", () => {
    expect(() => assertAcceptanceDeliveryReady("test-order", {}, now)).not.toThrow();
  });
  it("cannot defer original production or another preview", () => {
    expect(() => assertAcceptanceDeliveryReady("test-order", { ...env, VERCEL_PROJECT_PRODUCTION_URL: "arc-paylink.vercel.app" }, now)).not.toThrow();
  });
  it("does not defer other orders", () => {
    expect(() => assertAcceptanceDeliveryReady("other-order", env, now)).not.toThrow();
  });
  it("returns retryable 503 before the bounded deadline", () => {
    expect(() => assertAcceptanceDeliveryReady("test-order", env, now)).toThrow(expect.objectContaining({ status: 503 }));
  });
  it("automatically restores delivery at expiry", () => {
    expect(() => assertAcceptanceDeliveryReady("test-order", env, now + 300_000)).not.toThrow();
  });
  it("rejects a missing or excessively distant deadline for only the selected order", () => {
    for (const until of ["", new Date(now + 600_001).toISOString()])
      expect(() => assertAcceptanceDeliveryReady("test-order", { ...env, ARCPAYLINK_ACCEPTANCE_HOLD_UNTIL: until }, now)).toThrow(expect.objectContaining({ status: 503 }));
  });
});
