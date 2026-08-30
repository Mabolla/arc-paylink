"use client";

import { useMemo, useState } from "react";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { ARC_PAYLINK_FACTORY, type PrivateClaimPackage } from "@/lib/claim-package";
import { ARC_CHAIN_ID, ARC_EXPLORER_URL, ARC_USDC_ADDRESS, arcTestnet } from "@/lib/arc";
import { connectWallet, ensureArcTestnet, getBrowserProvider } from "@/lib/browser-wallet";

const TEST_AMOUNT_BASE_UNITS = 10_000n;
const TEST_AMOUNT_USDC = "0.01";
const TEST_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

const factoryAbi = parseAbi([
  "function createPayLink(uint256 amount,uint256 expiry,bytes32 secretHash) returns (bytes32 paymentId,address escrow)",
  "event PayLinkCreated(bytes32 indexed paymentId,address indexed escrow,address indexed sender,address token,uint256 amount,uint256 expiry,bytes32 secretHash)",
]);
const usdcAbi = parseAbi(["function transfer(address to,uint256 amount) returns (bool)"]);

type Stage = "ready" | "connected" | "creating" | "funding" | "complete" | "failed";

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Could not create the recipient test PayLink.";
}

export function TesterPayLinkCreator() {
  const [stage, setStage] = useState<Stage>("ready");
  const [account, setAccount] = useState<Address>();
  const [message, setMessage] = useState("Connect a funded Arc Testnet wallet to prepare one private tester package.");
  const [claimPackage, setClaimPackage] = useState<PrivateClaimPackage>();
  const [creationHash, setCreationHash] = useState<Hash>();
  const [fundingHash, setFundingHash] = useState<Hash>();
  const publicClient = useMemo(() => createPublicClient({ chain: arcTestnet, transport: http() }), []);

  async function connect() {
    try {
      const provider = getBrowserProvider();
      const address = await connectWallet(provider);
      await ensureArcTestnet(provider);
      setAccount(address);
      setStage("connected");
      setMessage("Wallet connected. Creating this package will fund an isolated escrow with 0.01 testnet USDC.");
    } catch (error) {
      setStage("failed");
      setMessage(errorMessage(error));
    }
  }

  async function createTesterPayLink() {
    if (!account) return;
    try {
      const provider = getBrowserProvider();
      await ensureArcTestnet(provider);
      const walletClient = createWalletClient({ account, chain: arcTestnet, transport: custom(provider) });
      const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const secretHash = keccak256(secret);
      const latestBlock = await publicClient.getBlock();
      const expiry = latestBlock.timestamp + BigInt(TEST_LIFETIME_SECONDS);

      setStage("creating");
      setMessage("Approve creation of the isolated Arc PayLink escrow.");
      const createHash = await walletClient.writeContract({
        address: ARC_PAYLINK_FACTORY,
        abi: factoryAbi,
        functionName: "createPayLink",
        args: [TEST_AMOUNT_BASE_UNITS, expiry, secretHash],
      });
      setCreationHash(createHash);
      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      if (createReceipt.status !== "success") throw new Error("Arc PayLink escrow creation failed.");

      let created: { paymentId: Hex; escrow: Address } | undefined;
      for (const log of createReceipt.logs) {
        if (log.address.toLowerCase() !== ARC_PAYLINK_FACTORY.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === "PayLinkCreated") {
            created = { paymentId: decoded.args.paymentId, escrow: decoded.args.escrow };
            break;
          }
        } catch {
          // Ignore unrelated factory logs.
        }
      }
      if (!created) throw new Error("Arc PayLink creation event was not found.");

      setStage("funding");
      setMessage("Approve funding the isolated escrow with 0.01 testnet USDC.");
      const fundHash = await walletClient.writeContract({
        address: ARC_USDC_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [created.escrow, TEST_AMOUNT_BASE_UNITS],
      });
      setFundingHash(fundHash);
      const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
      if (fundReceipt.status !== "success") throw new Error("Arc PayLink escrow funding failed.");

      const portablePackage: PrivateClaimPackage = {
        network: "Arc Testnet",
        chainId: ARC_CHAIN_ID,
        factory: ARC_PAYLINK_FACTORY,
        paymentId: created.paymentId,
        escrow: created.escrow,
        amountBaseUnits: TEST_AMOUNT_BASE_UNITS.toString(),
        amountUsdc: TEST_AMOUNT_USDC,
        expiry: new Date(Number(expiry) * 1000).toISOString(),
        secretHash,
        secret,
      };
      setClaimPackage(portablePackage);
      setStage("complete");
      setMessage("Private tester package is ready. Download it and share it with exactly one intended tester.");
    } catch (error) {
      setStage("failed");
      setMessage(errorMessage(error));
    }
  }

  function downloadPackage() {
    if (!claimPackage) return;
    const blob = new Blob([`${JSON.stringify(claimPackage, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `arc-paylink-${claimPackage.paymentId.slice(2, 10)}.private-claim.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="wallet-panel" aria-labelledby="tester-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Controlled testing</p><h2 id="tester-heading">Prepare one tester PayLink</h2></div>
        <span className="step">0.01 USDC</span>
      </div>
      <p className="wallet-copy">Create and fund one isolated Arc Testnet escrow, then download its single-use private recipient package. Your browser wallet signs both transactions; Arc PayLink never receives its key.</p>
      {account && <dl className="payment-details wallet-details">
        <div><dt>Sender</dt><dd className="mono">{account.slice(0, 8)}…{account.slice(-6)}</dd></div>
        <div><dt>Test amount</dt><dd>{TEST_AMOUNT_USDC} USDC</dd></div>
        {claimPackage && <div><dt>Escrow</dt><dd className="mono">{claimPackage.escrow.slice(0, 8)}…{claimPackage.escrow.slice(-6)}</dd></div>}
      </dl>}
      <div className={`status-box ${stage === "complete" ? "paid" : stage === "failed" ? "failed" : stage === "creating" || stage === "funding" ? "pending" : ""}`} role="status">
        <b>{message}</b>
        {(stage === "creating" || stage === "funding") && <span className="spinner" />}
      </div>
      {!account && <button className="primary-button full" onClick={connect}>Connect Arc wallet <span aria-hidden>→</span></button>}
      {account && (stage === "connected" || stage === "failed") && !claimPackage && <button className="primary-button full" onClick={createTesterPayLink}>Create 0.01 USDC tester PayLink <span aria-hidden>→</span></button>}
      {claimPackage && <button className="primary-button full" onClick={downloadPackage}>Download private tester package <span aria-hidden>↓</span></button>}
      {creationHash && <a className="explorer-link" href={`${ARC_EXPLORER_URL}/tx/${creationHash}`} target="_blank" rel="noreferrer">View escrow creation on ArcScan ↗</a>}
      {fundingHash && <a className="explorer-link" href={`${ARC_EXPLORER_URL}/tx/${fundingHash}`} target="_blank" rel="noreferrer">View escrow funding on ArcScan ↗</a>}
      <p className="security-note">Testnet only. Never post the downloaded package publicly; whoever holds it can claim that one escrow.</p>
    </section>
  );
}
