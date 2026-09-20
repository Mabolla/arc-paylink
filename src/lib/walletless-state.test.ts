import { describe, expect, it } from "vitest";
import { outstandingFunding, walletlessStatus } from "./walletless-state";

describe("walletless escrow state", () => {
  it("distinguishes empty and partial awaiting-funds escrows", () => {
    const now = Date.parse("2026-09-20T00:00:00.000Z");
    expect(walletlessStatus(0, "2027-01-01T00:00:00.000Z", 0n, now)).toBe("awaiting funds");
    expect(walletlessStatus(0, "2027-01-01T00:00:00.000Z", 2_000n, now)).toBe("partially funded");
    expect(walletlessStatus(0, "2026-09-19T00:00:00.000Z", 2_000n, now)).toBe("expired");
  });

  it("funds only the outstanding amount and never overfunds", () => {
    expect(outstandingFunding(10_000n, 2_000n)).toBe(8_000n);
    expect(outstandingFunding(10_000n, 10_000n)).toBe(0n);
    expect(outstandingFunding(10_000n, 12_000n)).toBe(0n);
  });
});
