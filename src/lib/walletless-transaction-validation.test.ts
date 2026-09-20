import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { ARC_USDC_ADDRESS } from "./arc";
import type { VerifiedClaimContext } from "./claim-validation";
import { verifyWalletlessTransactionEvidence } from "./walletless-transaction-validation";

const claim: VerifiedClaimContext = {
  factory: `0x${"11".repeat(20)}`,
  paymentId: `0x${"22".repeat(32)}`,
  escrow: `0x${"33".repeat(20)}`,
  sender: `0x${"44".repeat(20)}`,
  amountBaseUnits: 10_000n,
  expiry: 2_000_000_000,
  secretHash: `0x${"55".repeat(32)}`,
};
const creationHash = `0x${"66".repeat(32)}` as const;
const fundingHash = `0x${"77".repeat(32)}` as const;
const createdEvent = parseAbiItem("event PayLinkCreated(bytes32 indexed paymentId,address indexed escrow,address indexed sender,address token,uint256 amount,uint256 expiry,bytes32 secretHash)");
const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");

function reader(value = claim.amountBaseUnits) {
  return {
    async getTransactionReceipt({ hash }: { hash: `0x${string}` }) {
      if (hash === creationHash) return { status: "success" as const, logs: [{
        address: claim.factory,
        topics: encodeEventTopics({ abi: [createdEvent], eventName: "PayLinkCreated", args: { paymentId: claim.paymentId, escrow: claim.escrow, sender: claim.sender } }),
        data: encodeAbiParameters([
          { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
        ], [ARC_USDC_ADDRESS, claim.amountBaseUnits, BigInt(claim.expiry), claim.secretHash]),
      }] };
      return { status: "success" as const, logs: [{
        address: ARC_USDC_ADDRESS,
        topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from: claim.sender, to: claim.escrow } }),
        data: encodeAbiParameters([{ type: "uint256" }], [value]),
      }] };
    },
  };
}

describe("walletless transaction evidence", () => {
  it("accepts matching creation and exact funding receipts", async () => {
    await expect(verifyWalletlessTransactionEvidence({ creationHash, fundingHash }, claim, reader())).resolves.toEqual({ creationHash, fundingHash });
  });

  it("rejects a funding receipt for the wrong amount", async () => {
    await expect(verifyWalletlessTransactionEvidence({ creationHash, fundingHash }, claim, reader(1n))).rejects.toThrow("does not fund");
  });

  it("rejects malformed transaction hashes before querying Arc", async () => {
    await expect(verifyWalletlessTransactionEvidence({ creationHash: "no", fundingHash }, claim, reader())).rejects.toThrow("creationHash");
  });
});
