import { describe, expect, it } from "vitest";
import { walletlessRegistrationMessage } from "./walletless-registration";

const input = {
  sender: "0x1111111111111111111111111111111111111111" as const,
  factory: "0x2222222222222222222222222222222222222222" as const,
  paymentId: `0x${"33".repeat(32)}` as const,
  escrow: "0x4444444444444444444444444444444444444444" as const,
  recipientEmail: "Recipient@Example.com",
  issuedAt: "2026-09-20T12:00:00.000Z",
};

describe("walletless creator registration message", () => {
  it("is deterministic and hides the plaintext recipient email", () => {
    const message = walletlessRegistrationMessage(input);
    expect(message).toContain("Arc PayLink creator registration");
    expect(message).toContain("Chain ID: 5042002");
    expect(message).not.toContain("recipient@example.com");
    expect(walletlessRegistrationMessage({ ...input, recipientEmail: "recipient@example.com" })).toBe(message);
  });
});
