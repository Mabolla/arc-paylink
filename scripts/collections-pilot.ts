import { createHmac } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, keccak256, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS, arcChain } from "../src/lib/arc";
import { externalPaymentMessage, externalTransaction, type ExternalIntent } from "../src/lib/commerce/external-payment";
import type { PublicOrder } from "../src/lib/commerce/types";

// This runner is deliberately fixed to an internal 0.01-USDC acceptance payment.
// The recipient is deterministically controlled by the existing project signer.
const BASE = "https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app";
const EXPECTED_PAYER = "0xE7be265f2301E08a6EaE5Cfd0C1113a7Cd35b3dd";
const DERIVATION = "ArcPayLink/internal-collections-recipient/v1";
const AMOUNT = 10_000n;
const MAX_FEE_USDC = parseUnits("0.01", 18);
const config = JSON.parse(readFileSync(".github/collections-pilot.json", "utf8"));
const evidence: Record<string, unknown> = { mode: config.mode, internalAcceptance: true, externalCustomers: 0, amountUsdc: "0.01", maxGasUsdc: "0.01", generatedAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA };
function save() {
  mkdirSync("pilot-evidence", { recursive: true });
  writeFileSync("pilot-evidence/collections-pilot.json", JSON.stringify(evidence, null, 2) + "\n");
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(BASE + path, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(55000), headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`Checkout HTTP ${response.status}: ${String(value.error ?? "request failed")}`);
  return value;
}
async function main() {
  if (ARC_CHAIN_ID !== 5042) throw new Error("Mainnet configuration required.");
  const secret = process.env.ARC_PILOT_PRIVATE_KEY?.trim();
  if (!secret || !/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new Error("Configured pilot signing key is missing or invalid.");
  const payer = privateKeyToAccount(secret as `0x${string}`);
  if (payer.address.toLowerCase() !== EXPECTED_PAYER.toLowerCase()) throw new Error("Configured key is not the existing project signer.");
  // Recoverable from the existing signer and this public domain string; no key is logged or exported.
  const recipientKey = `0x${createHmac("sha256", Buffer.from(secret.slice(2), "hex")).update(DERIVATION).digest("hex")}` as const;
  const recipient = privateKeyToAccount(recipientKey).address;
  const transport = http("https://rpc.mainnet.arc.io", { timeout: 15000, retryCount: 1 });
  const client = createPublicClient({ chain: arcChain, transport });
  if (await client.getChainId() !== 5042) throw new Error("RPC returned a different chain.");
  const [nonce, usdc, native, fees] = await Promise.all([
    client.getTransactionCount({ address: payer.address, blockTag: "pending" }),
    client.readContract({ address: ARC_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [payer.address] }),
    client.getBalance({ address: payer.address }),
    client.estimateFeesPerGas(),
  ]);
  const txTemplate = externalTransaction({ recipient, amount: "0.01", chainId: 5042 } as PublicOrder, nonce);
  const estimate = await client.estimateGas({ account: payer.address, to: txTemplate.to, data: txTemplate.data, value: 0n });
  const gas = estimate * 120n / 100n;
  const maximumFee = gas * fees.maxFeePerGas;
  Object.assign(evidence, { payer: payer.address, recipient, recipientDerivation: DERIVATION, chainId: 5042, nonce, gasLimit: gas.toString(), maxFeePerGas: fees.maxFeePerGas.toString(), maximumGasUsdc: formatUnits(maximumFee, 18), balanceSufficient: usdc >= AMOUNT && native >= parseUnits("0.01", 18) + maximumFee, keyMatched: true });
  save();
  if (maximumFee > MAX_FEE_USDC) throw new Error("Estimated maximum gas exceeds the fixed 0.01-USDC cap.");
  if (usdc < AMOUNT || native < parseUnits("0.01", 18) + maximumFee) throw new Error("Insufficient balance for the fixed internal test and gas.");
  if (config.mode === "preflight") { evidence.preflightPassed = true; save(); console.log(JSON.stringify(evidence)); return; }
  if (!["execute", "confirm"].includes(config.mode) || config.confirmation !== "INTERNAL_COLLECTIONS_EXACT_0_01_USDC") throw new Error("Exact pilot execution gate missing.");
  if (!/^[0-9a-f-]{36}$/.test(config.orderId)) throw new Error("A specific existing order is required.");
  const { order } = await api<{ order: PublicOrder }>(`/api/checkout/${config.orderId}`);
  if (order.id !== config.orderId || order.amount !== "0.01" || order.chainId !== 5042 || order.recipient.toLowerCase() !== recipient.toLowerCase()) throw new Error("Order differs from the exact internal acceptance terms.");
  evidence.orderId = order.id;
  evidence.checkout = `${BASE}/checkout/${order.id}`;
  if (order.status === "paid") { evidence.alreadyPaid = true; evidence.receipt = order.receipt; save(); console.log(JSON.stringify(evidence)); return; }
  const path = `/api/checkout/${order.id}/external`;
  if (config.mode === "confirm") {
    if (!/^0x[0-9a-fA-F]{64}$/.test(config.transactionHash)) throw new Error("A specific transaction hash is required for recovery.");
    evidence.confirmed = await api(path, { action: "confirm", transactionHash: config.transactionHash });
    save(); console.log(JSON.stringify(evidence)); return;
  }
  // A retry after broadcast cannot advance the nonce and send again.
  if (!Number.isSafeInteger(config.expectedNonce) || nonce !== config.expectedNonce) throw new Error("Signer nonce changed; reconcile the earlier attempt before running any new transfer.");
  if (order.status !== "pending") throw new Error("Order is already reserved; use receipt-only recovery, never a second send.");
  const offered = await api<{ reserved: boolean; intent?: ExternalIntent; message?: string }>(`${path}?payer=${payer.address}`);
  const intent = offered.intent;
  if (offered.reserved || !intent || intent.nonce !== nonce || intent.payer.toLowerCase() !== payer.address.toLowerCase()) throw new Error("Unexpected external-wallet reservation.");
  if (offered.message !== externalPaymentMessage(order, intent)) throw new Error("Server signing message differs from the reviewed order.");
  const signature = await payer.signMessage({ message: externalPaymentMessage(order, intent) });
  const reserved = await api<{ alreadyReserved: boolean; transaction?: typeof txTemplate }>(path, { action: "reserve", ...intent, signature });
  if (reserved.alreadyReserved || !reserved.transaction || JSON.stringify(reserved.transaction) !== JSON.stringify(txTemplate)) throw new Error("Reservation did not return the exact one-time transaction.");
  const serialized = await payer.signTransaction({ chainId: 5042, to: txTemplate.to, data: txTemplate.data, value: 0n, nonce, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, type: "eip1559" });
  const transactionHash = keccak256(serialized);
  Object.assign(evidence, { transactionHash, stage: "signed-not-yet-broadcast" }); save();
  const wallet = createWalletClient({ account: payer, chain: arcChain, transport });
  const broadcastHash = await wallet.sendRawTransaction({ serializedTransaction: serialized });
  if (broadcastHash !== transactionHash) throw new Error("RPC returned a different transaction hash.");
  evidence.stage = "broadcast"; save();
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 90000 });
  if (receipt.status !== "success") throw new Error("Onchain transaction failed; do not repeat payment.");
  Object.assign(evidence, { stage: "confirmed-onchain", blockNumber: receipt.blockNumber.toString(), actualGasUsdc: formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18) }); save();
  const result = await api<{ order: PublicOrder }>(path, { action: "confirm", transactionHash });
  if (result.order.status !== "paid" || result.order.receipt?.transactionHash !== transactionHash) throw new Error("Checkout receipt has not reconciled yet. Recover the same hash.");
  Object.assign(evidence, { stage: "recorded-paid", receipt: result.order.receipt, realTransfers: 1 }); save();
  console.log(JSON.stringify(evidence));
}
main().catch((error: unknown) => {
  // Do not serialize SDK errors: their nested requests may contain signed payloads.
  evidence.failed = true;
  evidence.failure = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message).slice(0, 400) : "Pilot failed";
  save(); console.error(JSON.stringify(evidence)); process.exitCode = 1;
});
