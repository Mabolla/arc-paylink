import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAddress, isHash } from "viem";
import { ARC_USDC_ADDRESS } from "../src/lib/arc";
import { normalizeUsdcAmount } from "../src/lib/amount";

const execFileAsync = promisify(execFile);
type WalletInput = { walletAddress: string; chain: "ARC" | "ARC-TESTNET"; binary?: string };

async function runCli(binary: string, args: string[]): Promise<unknown> {
  let stdout: string;
  const environment: NodeJS.ProcessEnv = { ...process.env, DO_NOT_TRACK: "1" };
  // Acceptance belongs to the user's explicit CLI setup, not a payment invocation.
  // An unrelated parent shell/CI setting must never silently accept new terms.
  delete environment.CIRCLE_ACCEPT_TERMS;
  try {
    ({ stdout } = await execFileAsync(binary, args, {
      timeout: 120_000, maxBuffer: 1_000_000, windowsHide: true,
      // Official CLI privacy setting. Keep invoice/wallet operations out of optional telemetry.
      env: environment,
    }));
  } catch {
    // Never put raw CLI stdout/stderr (which can include session diagnostics) in MCP results.
    throw new Error("Circle CLI did not complete successfully. Its transfer result may be unknown; reconcile before retrying.");
  }
  try { return JSON.parse(stdout); }
  catch { throw new Error("Circle CLI did not return a valid JSON result. Reconcile before retrying."); }
}

export async function assertAgentWallet(input: WalletInput): Promise<void> {
  const wallet = getAddress(input.walletAddress);
  const output = await runCli(input.binary ?? "circle", ["wallet", "list", "--type", "agent", "--chain", input.chain, "--output", "json"]) as { data?: { wallets?: Array<{ type?: string; address?: string; blockchain?: string }> } };
  if (!output.data?.wallets?.some((entry) => entry.type === "agent" && entry.blockchain === input.chain && entry.address?.toLowerCase() === wallet.toLowerCase())) {
    throw new Error("The configured address is not an authenticated Circle Agent Wallet on this Arc network.");
  }
}

export function parseCircleTransfer(output: unknown): `0x${string}` {
  const data = output && typeof output === "object" ? (output as { data?: Record<string, unknown> }).data : undefined;
  const hash = data?.txHash;
  if (!data || ["FAILED", "CANCELLED", "DENIED"].includes(String(data.state))) throw new Error("Circle transfer was rejected or failed.");
  // CLI 1.1.4 returns { data: { txHash, blockHash, id, ... } }. Never pick blockHash,
  // an arbitrary 32-byte string, or a hash nested in error text.
  if (typeof hash !== "string" || !isHash(hash)) throw new Error("Circle CLI returned no transaction hash. Reconcile the recorded attempt before retrying.");
  return hash as `0x${string}`;
}

export async function transferUsdc(input: WalletInput & {
  recipient: string; amount: string; idempotencyKey: string;
}): Promise<{ transactionHash: `0x${string}` }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) throw new Error("Payment idempotency key is invalid.");
  const output = await runCli(input.binary ?? "circle", [
    "wallet", "transfer", getAddress(input.recipient),
    "--amount", normalizeUsdcAmount(input.amount),
    "--address", getAddress(input.walletAddress),
    "--chain", input.chain,
    "--token", ARC_USDC_ADDRESS,
    "--idempotency-key", input.idempotencyKey,
    "--output", "json",
  ]);
  return { transactionHash: parseCircleTransfer(output) };
}
