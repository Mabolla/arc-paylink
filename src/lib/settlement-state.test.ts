import { describe, expect, it } from "vitest";
import { classifySettlement } from "./settlement-state";

const recipient = "0x1111111111111111111111111111111111111111";
const base = { expectedRecipient: recipient, expectedAmountBaseUnits: 1_000_000n, destinationFinalized: true };

describe("classifySettlement", () => {
  it("classifies exact and fee-adjusted settlement", () => {
    expect(classifySettlement({ ...base, actualRecipient: recipient, recipientAmountBaseUnits: 1_000_000n }).state).toBe("settled");
    expect(classifySettlement({ ...base, actualRecipient: recipient, recipientAmountBaseUnits: 999_870n, bridgeFeeBaseUnits: 130n })).toMatchObject({ state: "fee-adjusted", recoveryAction: "record-fee", outstandingBaseUnits: 0n });
  });
  it("classifies pending, partial, duplicate, and mismatched outcomes", () => {
    expect(classifySettlement({ ...base, destinationFinalized: false }).state).toBe("pending");
    expect(classifySettlement({ ...base, actualRecipient: recipient, recipientAmountBaseUnits: 900_000n })).toMatchObject({ state: "partial", outstandingBaseUnits: 100_000n });
    expect(classifySettlement({ ...base, duplicate: true }).state).toBe("duplicate");
    expect(classifySettlement({ ...base, actualRecipient: "0x2222222222222222222222222222222222222222", recipientAmountBaseUnits: 1_000_000n }).state).toBe("mismatched");
    expect(classifySettlement({ ...base, actualRecipient: recipient, recipientAmountBaseUnits: 1_100_000n })).toMatchObject({ state: "mismatched", recoveryAction: "manual-review" });
  });
});
