import { describe, expect, it } from "vitest";
import type { TransactionReceipt } from "viem";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "./arc";
import { settlePaymentRequest } from "./settle-payment-request";

const recipient = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345" as const;
const mintHash = "0x02cc00bd06e3e87b8bf9a042bdad7d7c6b566a84b7bd3f14a4afdff85c404741" as const;
const burnHash = "0xc3c0368632821d4656c1cba2348f0a338911ef6b7cacc2cb1d9a6cfb6e37169c" as const;
const request = { title: "Real CCTP proof", amount: "1", recipient, route: "bridge" as const };
const transferLog = {
  address: ARC_USDC_ADDRESS,
  topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x00000000000000000000000094705a9d675daa924f9190eca4c05ed6b12d5345"],
  data: "0x00000000000000000000000000000000000000000000000000000000000f4240",
  blockNumber: 57_855_495n,
  transactionHash: mintHash,
  transactionIndex: 12,
  blockHash: "0x80d0b5a1d4bfe6beb30b5791242698738e23dca2b06e801e0450a8ad6bfd2832",
  logIndex: 36,
  removed: false,
};
const receipt = (overrides: Record<string, unknown> = {}) => ({ transactionHash: mintHash, blockNumber: 57_855_495n, status: "success", logs: [transferLog], ...overrides }) as unknown as TransactionReceipt;
const bridge = (overrides: Record<string, unknown> = {}) => ({ amount: "1", token: "USDC", state: "success", provider: "cctp-v2", source: { address: recipient, chain: { type: "evm", chainId: 84_532 } }, destination: { address: recipient, recipientAddress: recipient, useForwarder: false, chain: { type: "evm", chainId: ARC_CHAIN_ID } }, steps: [{ name: "Burn", state: "success", txHash: burnHash }, { name: "FetchAttestation", state: "success" }, { name: "Mint", state: "success", txHash: mintHash, forwarded: false }], ...overrides }) as never;

describe("settlePaymentRequest", () => {
  it("settles the real Base Sepolia to Arc proof fixture", () => expect(settlePaymentRequest({ request, bridgeResult: bridge(), destinationReceipt: receipt() })).toMatchObject({ paymentState: "settled", mintTransactionHash: mintHash, amountBaseUnits: 1_000_000n }));
  it.each([
    ["wrong recipient", { request: { ...request, recipient: "0x1111111111111111111111111111111111111111" as const } }],
    ["wrong amount", { request: { ...request, amount: "2" } }],
    ["wrong token", { destinationReceipt: receipt({ logs: [{ ...transferLog, address: "0x1111111111111111111111111111111111111111" }] }) }],
    ["reverted receipt", { destinationReceipt: receipt({ status: "reverted" }) }],
    ["missing receipt", { destinationReceipt: undefined }],
    ["missing mint", { bridgeResult: bridge({ steps: [{ name: "Burn", state: "success", txHash: burnHash }] }) }],
    ["forwarder", { bridgeResult: bridge({ destination: { address: recipient, recipientAddress: recipient, useForwarder: true, chain: { type: "evm", chainId: ARC_CHAIN_ID } } }) }],
  ])("rejects %s", (_, overrides) => expect(() => settlePaymentRequest({ request, bridgeResult: bridge(), destinationReceipt: receipt(), ...overrides })).toThrow());
});
