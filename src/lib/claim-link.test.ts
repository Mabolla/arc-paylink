import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { ARC_PAYLINK_FACTORY } from "./claim-package";
import { claimLink, encodeClaimFragment, parseClaimFragment } from "./claim-link";

const secret = `0x${"11".repeat(32)}` as const;
const packageFixture = {
  network: "Arc Testnet",
  chainId: 5_042_002 as const,
  factory: ARC_PAYLINK_FACTORY,
  paymentId: `0x${"22".repeat(32)}` as const,
  escrow: "0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B" as const,
  amountBaseUnits: "10000",
  amountUsdc: "0.01",
  expiry: "2027-09-04T22:19:49.000Z",
  secretHash: keccak256(secret),
  secret,
};

describe("private claim links", () => {
  it("round-trips a verified package through a URL fragment", () => {
    const fragment = encodeClaimFragment(packageFixture);
    expect(parseClaimFragment(fragment)).toEqual(packageFixture);
    expect(claimLink("https://pay.example", packageFixture)).toBe(`https://pay.example/claim#${fragment}`);
  });

  it("returns null when no claim fragment is present", () => {
    expect(parseClaimFragment("#other=value")).toBeNull();
  });

  it("rejects malformed and tampered claim fragments", () => {
    expect(() => parseClaimFragment("#claim=not+base64"))
      .toThrow("This Arc PayLink is invalid.");
    const encoded = encodeClaimFragment(packageFixture).replace(/.$/, "A");
    expect(() => parseClaimFragment(encoded)).toThrow();
  });
});
