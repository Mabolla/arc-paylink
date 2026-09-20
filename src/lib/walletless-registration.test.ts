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

  it("canonicalizes address casing before constructing the signed message", () => {
    const lowerCaseMessage = walletlessRegistrationMessage({
      sender: "0x94705a9d675daa924f9190eca4c05ed6b12d5345",
      factory: "0x1234567890abcdef1234567890abcdef12345678",
      paymentId: `0x${"11".repeat(32)}`,
      escrow: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      recipientEmail: "recipient@example.com",
      issuedAt: "2026-09-20T00:00:00.000Z",
    });
    const mixedCaseMessage = walletlessRegistrationMessage({
      sender: "0x94705A9d675dAa924F9190ECa4C05ED6B12d5345",
      factory: "0x1234567890AbcdEF1234567890aBcdef12345678",
      paymentId: `0x${"11".repeat(32)}`,
      escrow: "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD",
      recipientEmail: "recipient@example.com",
      issuedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(lowerCaseMessage).toBe(mixedCaseMessage);
  });
});
