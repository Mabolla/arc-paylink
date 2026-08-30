import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { ARC_PAYLINK_FACTORY, parsePrivateClaimPackage } from "@/lib/claim-package";

const secret = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

function validPackage() {
  return {
    network: "Arc Testnet",
    chainId: 5_042_002,
    factory: ARC_PAYLINK_FACTORY,
    paymentId: "0x2222222222222222222222222222222222222222222222222222222222222222",
    escrow: "0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B",
    amountBaseUnits: "10000",
    amountUsdc: "0.01",
    expiry: "2026-09-04T22:19:49.000Z",
    secretHash: keccak256(secret),
    secret,
  };
}

describe("parsePrivateClaimPackage", () => {
  it("accepts a portable Arc PayLink package", () => {
    expect(parsePrivateClaimPackage(validPackage())).toMatchObject({ amountBaseUnits: "10000", amountUsdc: "0.01" });
  });

  it("rejects a secret that does not match the package hash", () => {
    expect(() => parsePrivateClaimPackage({ ...validPackage(), secret: "0x" + "33".repeat(32) }))
      .toThrow("Claim package secret does not match its hash.");
  });

  it("rejects a package from an untrusted factory", () => {
    expect(() => parsePrivateClaimPackage({ ...validPackage(), factory: "0x0000000000000000000000000000000000000001" }))
      .toThrow("This package was not created by the Arc PayLink factory.");
  });
});
