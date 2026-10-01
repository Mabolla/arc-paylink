import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ARC_USDC_ADDRESS } from "../src/lib/arc";
import { assertAgentWallet, parseCircleTransfer, transferUsdc } from "./circle-cli";

const directories: string[] = [];
const hash = `0x${"a".repeat(64)}` as const;
const walletAddress = "0x0000000000000000000000000000000000000002";
const recipient = "0x0000000000000000000000000000000000000001";
const idempotencyKey = "11223344-1122-4122-8122-112233445566";

async function fakeCli(output: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "arc-paylink-circle-cli-test-"));
  directories.push(directory);
  const binary = join(directory, "circle");
  const argsFile = join(directory, "args.json");
  await writeFile(binary, `#!/usr/bin/env node\nif (process.env.DO_NOT_TRACK !== '1') throw new Error('Optional CLI telemetry must be disabled');\nif (process.env.CIRCLE_ACCEPT_TERMS !== undefined) throw new Error('Payment invocations must not accept CLI terms');\nrequire('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(output))});\n`);
  await chmod(binary, 0o700);
  return { binary, argsFile };
}

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("Circle CLI 1.1.4 adapter", () => {
  it("does not inherit a parent's automatic terms acceptance setting", async () => {
    const previous = process.env.CIRCLE_ACCEPT_TERMS;
    process.env.CIRCLE_ACCEPT_TERMS = "1";
    try {
      const { binary } = await fakeCli({ data: { wallets: [{ type: "agent", address: walletAddress, blockchain: "ARC-TESTNET" }] } });
      await expect(assertAgentWallet({ walletAddress, chain: "ARC-TESTNET", binary })).resolves.toBeUndefined();
      expect(process.env.CIRCLE_ACCEPT_TERMS).toBe("1");
    } finally {
      if (previous === undefined) delete process.env.CIRCLE_ACCEPT_TERMS;
      else process.env.CIRCLE_ACCEPT_TERMS = previous;
    }
  });

  it("specifies ERC20 USDC, the approved wallet and a persisted idempotency key", async () => {
    const { binary, argsFile } = await fakeCli({ data: { state: "COMPLETE", txHash: hash } });
    await expect(transferUsdc({ recipient, amount: "1.250000", walletAddress, chain: "ARC-TESTNET", idempotencyKey, binary })).resolves.toEqual({ transactionHash: hash });
    expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual([
      "wallet", "transfer", recipient, "--amount", "1.25", "--address", walletAddress,
      "--chain", "ARC-TESTNET", "--token", ARC_USDC_ADDRESS, "--idempotency-key", idempotencyKey, "--output", "json",
    ]);
  });

  it("does not mistake a block hash, transaction ID or nested error for a transfer hash", () => {
    for (const output of [{ data: { blockHash: hash } }, { data: { id: hash } }, { error: { txHash: hash } }]) {
      expect(() => parseCircleTransfer(output)).toThrow();
    }
    expect(() => parseCircleTransfer({ data: { txHash: hash, state: "FAILED" } })).toThrow("failed");
  });

  it("requires an authenticated agent wallet on the selected network", async () => {
    const valid = await fakeCli({ data: { wallets: [{ type: "agent", address: walletAddress, blockchain: "ARC-TESTNET" }] } });
    await expect(assertAgentWallet({ walletAddress, chain: "ARC-TESTNET", binary: valid.binary })).resolves.toBeUndefined();
    for (const entry of [{ type: "local", blockchain: "ARC-TESTNET" }, { type: "agent", blockchain: "ARC" }]) {
      const wrong = await fakeCli({ data: { wallets: [{ ...entry, address: walletAddress }] } });
      await expect(assertAgentWallet({ walletAddress, chain: "ARC-TESTNET", binary: wrong.binary })).rejects.toThrow("not an authenticated");
    }
  });
});
