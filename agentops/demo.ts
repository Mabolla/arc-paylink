/** Offline rehearsal. Every invoice, approval, wallet response and RPC receipt is simulated. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createPublicClient, custom, encodeAbiParameters, encodeEventTopics, erc20Abi, toHex } from "viem";
import { arcChain, ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "../src/lib/arc";
import type { RequestView } from "../src/lib/request-lifecycle";
import { AuditLedger } from "./audit";
import { assertAgentWallet, transferUsdc } from "./circle-cli";
import { createAgentPolicy } from "./decision";
import { createAgentServer } from "./mcp";
import { loadPaylinkRequest, recordVerifiedPaylinkSettlement } from "./paylink";
import { verifyAgentPayment } from "./verification";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "arc-paylink-simulated-demo-"));
  const binary = join(directory, "simulated-circle");
  const callsPath = join(directory, "transfers.json");
  const walletAddress = "0x0000000000000000000000000000000000000002";
  const recipient = "0x0000000000000000000000000000000000000001";
  const hash = `0x${"a".repeat(64)}` as const;
  const blockHash = `0x${"b".repeat(64)}` as const;
  const chain = ARC_CHAIN_ID === 5042 ? "ARC" : "ARC-TESTNET";
  const now = new Date("2026-10-01T10:00:00.000Z");
  const timestamp = BigInt(now.getTime() / 1000 + 2);
  const requestId = "3a6f27e8-f6bd-43b2-9921-8b26e8b60890";
  const view: RequestView = {
    requestId, request: { title: "SIMULATED supplier invoice", amount: "5", recipient, route: "arc", chainId: ARC_CHAIN_ID, obligation: { kind: "invoice", id: "DEMO-INV-42" } },
    createdAt: "2026-09-30T00:00:00.000Z", status: "pending",
  };
  const invoice = { invoiceId: "DEMO-INV-42", obligationId: "DEMO-INV-42", recipient, amount: "5", dueDate: "2026-09-30T00:00:00.000Z" };
  const ledger = new AuditLedger(join(directory, "audit.jsonl"));
  let settlementCalls = 0;
  const httpServer = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === `/api/requests/${requestId}`) { res.end(JSON.stringify({ view })); return; }
    if (req.method === "POST" && req.url === `/api/requests/${requestId}/settle`) {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (JSON.parse(body).transactionHash !== hash) { res.writeHead(400); res.end("{}"); return; }
      if (++settlementCalls === 1) { res.writeHead(503); res.end(JSON.stringify({ error: "SIMULATED temporary outage" })); return; }
      view.status = "settled";
      view.transactionHash = hash;
      res.end(JSON.stringify({ view })); return;
    }
    res.writeHead(404); res.end("{}");
  });
  let client: Client | undefined;
  let server: ReturnType<typeof createAgentServer> | undefined;
  try {
    await writeFile(callsPath, "[]");
    const wallets = { data: { wallets: [{ type: "agent", address: walletAddress, blockchain: chain }] } };
    const submitted = { data: { txHash: hash, state: "COMPLETE" } };
    await writeFile(binary, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (args[1] === 'transfer') { const path = ${JSON.stringify(callsPath)}; const calls = JSON.parse(fs.readFileSync(path, 'utf8')); calls.push(args); fs.writeFileSync(path, JSON.stringify(calls)); }\nprocess.stdout.write(JSON.stringify(args[1] === 'list' ? ${JSON.stringify(wallets)} : ${JSON.stringify(submitted)}));\n`);
    await chmod(binary, 0o700);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    assert(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rpc = createPublicClient({ chain: arcChain, transport: custom({
      async request({ method }) {
        if (method === "eth_chainId") return toHex(ARC_CHAIN_ID);
        if (method === "eth_getTransactionReceipt") return {
          status: "0x1", transactionHash: hash, transactionIndex: "0x0", blockHash, blockNumber: "0x7b",
          from: walletAddress, to: ARC_USDC_ADDRESS, cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", contractAddress: null,
          logsBloom: `0x${"0".repeat(512)}`, type: "0x2",
          logs: [{ address: ARC_USDC_ADDRESS, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: walletAddress, to: recipient } }), data: encodeAbiParameters([{ type: "uint256" }], [5_000_000n]), blockNumber: "0x7b", blockHash, transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false }],
        };
        if (method === "eth_getBlockByHash") return { hash: blockHash, number: "0x7b", timestamp: toHex(timestamp), transactions: [] };
        throw new Error(`Unexpected simulated RPC method ${method}`);
      },
    }) });
    server = createAgentServer({
      ledger, walletAddress, now: () => now,
      policy: () => createAgentPolicy({ allowedRecipients: recipient, maxPaymentUsdc: "5", dailyLimitUsdc: "10" }),
      load: (id) => loadPaylinkRequest(baseUrl, id),
      preflight: () => assertAgentWallet({ walletAddress, chain, binary }),
      transfer: (request, idempotencyKey) => transferUsdc({ walletAddress, recipient: request.request.recipient, amount: request.request.amount, chain, binary, idempotencyKey }),
      verify: (transactionHash, request) => verifyAgentPayment(rpc, transactionHash, request.request),
      sync: (id, transactionHash) => recordVerifiedPaylinkSettlement({ baseUrl, requestId: id, transactionHash }),
    });
    client = new Client({ name: "explicitly-simulated-demo", version: "1.0.0" }, { capabilities: { elicitation: { form: {} } } });
    const approvals: string[] = [];
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      approvals.push(request.params.message);
      return { action: "accept", content: { approve: true } }; // Simulation only, never connected to real wallet.
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const transcript: Array<{ tool: string; result: unknown }> = [];
    async function call(tool: string, args: Record<string, unknown>) {
      const result = await client!.callTool({ name: tool, arguments: args });
      const body = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      assert(!result.isError, JSON.stringify(body));
      transcript.push({ tool, result: body });
      return body;
    }
    await call("inspect_paylink", { requestId });
    assert.equal((await call("evaluate_invoice", { requestId, invoice: { ...invoice, amount: "4.99" } })).decision.outcome, "review");
    assert.equal((await call("evaluate_invoice", { requestId, invoice })).decision.outcome, "payable");
    assert.equal((await call("pay_approved_invoice", { requestId, invoice })).state, "sync-required");
    assert.equal((await call("pay_approved_invoice", { requestId, invoice: { ...invoice, invoiceId: "DEMO-ALIAS" } })).state, "blocked");
    assert.equal((await call("reconcile_payment", { requestId })).state, "settled");
    const audit = await call("read_agent_audit", {});
    const transfers = JSON.parse(await readFile(callsPath, "utf8")) as string[][];
    assert.equal(transfers.length, 1);
    assert.equal(approvals.length, 1);
    assert.equal(settlementCalls, 2);
    assert.equal(audit.integrity, "verified");
    const evidence = {
      mode: "SIMULATED — NO REAL PAYMENT, USER OR BUSINESS ACTIVITY", generatedAt: new Date().toISOString(),
      exercised: ["MCP SDK client/server", "exact approval form", "real policy and durable audit", "child-process CLI adapter with simulated executable", "local HTTP PayLink adapter with simulated service", "real viem decoding against simulated Arc RPC", "no-resend recovery"],
      checks: { amountMismatchBlocked: true, singleTransfer: true, aliasRetryBlocked: true, statusRecovered: true, auditIntegrityVerified: true },
      simulatedTransferCount: transfers.length, settlementHttpCalls: settlementCalls, approvals, transferArguments: transfers, transcript,
    };
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex >= 0) {
      const path = process.argv[outputIndex + 1];
      assert(path, "--output requires a file path");
      await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
      console.log(`SIMULATED rehearsal passed; evidence written to ${path}. No real payment was made.`);
    } else console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await client?.close();
    await server?.close();
    httpServer.closeAllConnections();
    if (httpServer.listening) await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
