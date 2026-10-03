import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPublicClient, getAddress, http, zeroAddress } from "viem";
import { arcChain, ARC_CHAIN_ID, ARC_RPC_URL } from "../src/lib/arc";
import { AuditLedger } from "./audit";
import { createAgentPolicy } from "./decision";
import { assertAgentWallet, transferUsdc } from "./circle-cli";
import { loadPaylinkRequest, recordVerifiedPaylinkSettlement } from "./paylink";
import { createAgentServer } from "./mcp";
import { verifyAgentPayment } from "./verification";

const baseUrl = process.env.ARCPAYLINK_BASE_URL ?? "http://127.0.0.1:3000";
const chain = ARC_CHAIN_ID === 5042 ? "ARC" : "ARC-TESTNET";
const walletAddress = getAddress(process.env.ARCPAYLINK_CIRCLE_WALLET_ADDRESS?.trim() || zeroAddress);
const binary = process.env.ARCPAYLINK_CIRCLE_BINARY ?? join(process.cwd(), "node_modules", ".bin", "circle");
const ledger = new AuditLedger(process.env.ARCPAYLINK_AUDIT_PATH ?? join(homedir(), ".local", "state", "arc-paylink-agentops", String(ARC_CHAIN_ID), "audit.jsonl"));
const client = createPublicClient({ chain: arcChain, transport: http(ARC_RPC_URL) });

const server = createAgentServer({
  ledger, walletAddress,
  policy: () => createAgentPolicy({
    allowedRecipients: process.env.ARCPAYLINK_ALLOWED_RECIPIENTS ?? "",
    maxPaymentUsdc: process.env.ARCPAYLINK_MAX_PAYMENT_USDC ?? "0",
    dailyLimitUsdc: process.env.ARCPAYLINK_DAILY_LIMIT_USDC ?? "0",
  }),
  load: (requestId) => loadPaylinkRequest(baseUrl, requestId),
  async preflight() {
    if (walletAddress === zeroAddress) throw new Error("Circle Agent Wallet address is not configured.");
    await assertAgentWallet({ walletAddress, chain, binary });
  },
  transfer: (view, idempotencyKey) => transferUsdc({ recipient: view.request.recipient, amount: view.request.amount, walletAddress, chain, idempotencyKey, binary }),
  verify: (hash, view) => verifyAgentPayment(client, hash, view.request),
  sync: (requestId, hash) => recordVerifiedPaylinkSettlement({ baseUrl, requestId, transactionHash: hash }),
});

void server.connect(new StdioServerTransport()).catch(() => {
  console.error("Arc PayLink AgentOps could not start.");
  process.exitCode = 1;
});
