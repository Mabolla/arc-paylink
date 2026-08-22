import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters, erc20Abi, type Address, type TransactionReceipt } from "viem";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "./arc";
import { checkFulfillment, verifyBridgeSettlement } from "./verify-bridge-settlement";

const recipient = "0x1111111111111111111111111111111111111111" as const;
const sender = "0x2222222222222222222222222222222222222222" as const;
const hash = `0x${"a".repeat(64)}` as `0x${string}`;
function log(address: string = ARC_USDC_ADDRESS, to: Address = recipient, value = 25_000_000n) {
  return { address, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: sender, to } }), data: encodeAbiParameters([{ type: "uint256" }], [value]), blockNumber: 1n, transactionHash: hash, transactionIndex: 0, blockHash: hash, logIndex: 0, removed: false } as never;
}
const receipt = (logs: unknown[], status: unknown = "success") => ({ transactionHash: hash, status, blockNumber: 1n, logs }) as unknown as TransactionReceipt;
const bridge = (steps: unknown[] = [{ name: "Mint", state: "success", txHash: hash }], extra = {}) => ({ amount: "25", token: "USDC", state: "success", provider: "cctp", source: { address: sender, chain: { type: "evm", chainId: 84532 } }, destination: { address: recipient, chain: { type: "evm", chainId: ARC_CHAIN_ID }, ...extra }, steps }) as never;
const input = (overrides: Record<string, unknown> = {}) => ({ bridgeResult: bridge(), destinationReceipt: receipt([log()]), expectedRecipient: recipient, expectedAmount: "25", expectedToken: ARC_USDC_ADDRESS, chain: { id: ARC_CHAIN_ID }, ...overrides });

describe("verifyBridgeSettlement", () => {
  it("verifies gross settlement net of the destination bridge fee", () => {
    const feeRecipient = "0x3333333333333333333333333333333333333333" as const;
    const result = verifyBridgeSettlement(input({ destinationReceipt: receipt([log(ARC_USDC_ADDRESS, recipient, 24_999_000n), log(ARC_USDC_ADDRESS, feeRecipient, 1_000n)]) }));
    expect(result).toMatchObject({ state: "verified", grossAmountBaseUnits: 25_000_000n, amountBaseUnits: 24_999_000n, bridgeFeeBaseUnits: 1_000n, recipient });
  });
  it.each([
    ["wrong recipient", { expectedRecipient: sender }],
    ["wrong amount", { expectedAmount: "26" }],
    ["wrong token", { expectedToken: sender }],
  ])("rejects %s", (_, overrides) => expect(() => verifyBridgeSettlement(input(overrides))).toThrow());
  it.each([
    ["reverted receipt", { destinationReceipt: receipt([log()], "reverted") }],
    ["indeterminate receipt", { destinationReceipt: receipt([log()], "pending") }],
    ["missing receipt", { destinationReceipt: undefined }],
    ["missing mint", { bridgeResult: bridge([]) }],
    ["successful burn without mint", { bridgeResult: bridge([{ name: "Burn", state: "success", txHash: hash }]) }],
    ["missing hash", { bridgeResult: bridge([{ name: "Mint", state: "success" }]) }],
    ["multiple matches", { destinationReceipt: receipt([log(), log()]) }],
    ["gross amount mismatch", { destinationReceipt: receipt([log(ARC_USDC_ADDRESS, recipient, 24_999_000n)]) }],
    ["forwarder", { bridgeResult: bridge([{ name: "Mint", state: "success", txHash: hash, forwarded: true }]) }],
  ])("rejects %s", (_, overrides) => expect(() => verifyBridgeSettlement(input(overrides))).toThrow());
  it("ignores unrelated token logs", () => expect(verifyBridgeSettlement(input({ destinationReceipt: receipt([log(sender), log()]) })).state).toBe("verified"));
});
describe("fulfillment", () => {
  it("reports available and duplicate ids without persistence", () => {
    expect(checkFulfillment("x", new Set())).toEqual({ state: "available", fulfillmentId: "x" });
    expect(checkFulfillment("x", new Set(["x"]))).toEqual({ state: "duplicate", fulfillmentId: "x" });
  });
});
