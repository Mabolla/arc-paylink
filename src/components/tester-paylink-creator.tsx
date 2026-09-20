"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  http,
  keccak256,
  formatUnits,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { ARC_PAYLINK_FACTORY, type PrivateClaimPackage } from "@/lib/claim-package";
import { claimLink } from "@/lib/claim-link";
import { ARC_CHAIN_ID, ARC_EXPLORER_URL, ARC_NETWORK_NAME, ARC_USDC_ADDRESS, arcChain } from "@/lib/arc";
import { connectWallet, ensureArcNetwork, getBrowserProvider } from "@/lib/browser-wallet";
import { normalizeUsdcAmount, parseUsdcAmount } from "@/lib/amount";
import { saveWalletlessPayLink } from "@/lib/walletless-paylink-client";
import { registerWalletlessPayLink } from "@/lib/walletless-registration-client";

const DEFAULT_LIFETIME_DAYS = 7;
const MAX_MAINNET_AMOUNT_BASE_UNITS = 5_000_000n;
const MAX_TESTNET_AMOUNT_BASE_UNITS = 1_000_000_000n;

const factoryAbi = parseAbi([
  "function createPayLink(uint256 amount,uint256 expiry,bytes32 secretHash) returns (bytes32 paymentId,address escrow)",
  "event PayLinkCreated(bytes32 indexed paymentId,address indexed escrow,address indexed sender,address token,uint256 amount,uint256 expiry,bytes32 secretHash)",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);

type Stage = "ready" | "connected" | "creating" | "funding" | "complete" | "failed";

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Could not create the recipient test PayLink.";
}

export function TesterPayLinkCreator() {
  const [stage, setStage] = useState<Stage>("ready");
  const [account, setAccount] = useState<Address>();
  const [message, setMessage] = useState(`Connect a funded ${ARC_NETWORK_NAME} wallet to prepare one private tester package.`);
  const [claimPackage, setClaimPackage] = useState<PrivateClaimPackage>();
  const [creationHash, setCreationHash] = useState<Hash>();
  const [fundingHash, setFundingHash] = useState<Hash>();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [amountUsdc, setAmountUsdc] = useState("0.01");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [lifetimeDays, setLifetimeDays] = useState(DEFAULT_LIFETIME_DAYS);
  const [copiedLink, setCopiedLink] = useState("");
  const publicClient = useMemo(() => createPublicClient({ chain: arcChain, transport: http() }), []);

  async function connect() {
    try {
      const provider = getBrowserProvider();
      const address = await connectWallet(provider);
      await ensureArcNetwork(provider);
      setAccount(address);
      setStage("connected");
      setMessage("Wallet connected. Review the payment, then create and fund its isolated escrow.");
    } catch (error) {
      setStage("failed");
      setMessage(errorMessage(error));
    }
  }

  async function createTesterPayLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    try {
      const normalizedTitle = title.trim();
      const normalizedReference = reference.trim();
      const normalizedEmail = recipientEmail.trim().toLowerCase();
      if (!normalizedTitle) throw new Error("Enter a payment title.");
      if (!normalizedReference) throw new Error("Enter a payment reference.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Enter a valid recipient email.");
      const amountBaseUnits = parseUsdcAmount(amountUsdc);
      const maximum = ARC_CHAIN_ID === 5_042 ? MAX_MAINNET_AMOUNT_BASE_UNITS : MAX_TESTNET_AMOUNT_BASE_UNITS;
      if (amountBaseUnits > maximum) throw new Error(`This pilot limits one PayLink to ${formatUnits(maximum, 6)} USDC.`);
      if (!Number.isInteger(lifetimeDays) || lifetimeDays < 1 || lifetimeDays > 30) throw new Error("Expiry must be between 1 and 30 days.");

      const provider = getBrowserProvider();
      await ensureArcNetwork(provider);
      const walletClient = createWalletClient({ account, chain: arcChain, transport: custom(provider) });
      const tokenBalance = await publicClient.readContract({
        address: ARC_USDC_ADDRESS,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [account],
      });
      if (tokenBalance < amountBaseUnits) throw new Error(`Your wallet does not have enough ${ARC_NETWORK_NAME} USDC for this PayLink.`);
      const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const secretHash = keccak256(secret);
      const latestBlock = await publicClient.getBlock();
      const expiry = latestBlock.timestamp + BigInt(lifetimeDays * 24 * 60 * 60);

      setStage("creating");
      setMessage("Approve creation of the isolated Arc PayLink escrow.");
      const createHash = await walletClient.writeContract({
        address: ARC_PAYLINK_FACTORY,
        abi: factoryAbi,
        functionName: "createPayLink",
        args: [amountBaseUnits, expiry, secretHash],
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

      const portablePackage: PrivateClaimPackage = {
        network: ARC_NETWORK_NAME,
        chainId: ARC_CHAIN_ID,
        factory: ARC_PAYLINK_FACTORY,
        paymentId: created.paymentId,
        escrow: created.escrow,
        amountBaseUnits: amountBaseUnits.toString(),
        amountUsdc: normalizeUsdcAmount(amountUsdc),
        expiry: new Date(Number(expiry) * 1000).toISOString(),
        secretHash,
        secret,
        title: normalizedTitle,
        reference: normalizedReference,
        recipientEmail: normalizedEmail,
      };
      const createdAt = new Date().toISOString();
      const pendingReference = {
        sender: account,
        recipientEmail: normalizedEmail,
        createdAt,
        creationHash: createHash,
        claimPackage: portablePackage,
      };
      // Persist the secret as soon as the escrow exists. A rejected funding signature,
      // refresh, or connection loss must not orphan the creator's recovery context.
      saveWalletlessPayLink(window.localStorage, pendingReference);

      setStage("funding");
      setMessage(`Approve funding the isolated escrow with ${normalizeUsdcAmount(amountUsdc)} USDC.`);
      const fundHash = await walletClient.writeContract({
        address: ARC_USDC_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [created.escrow, amountBaseUnits],
      });
      setFundingHash(fundHash);
      const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
      if (fundReceipt.status !== "success") throw new Error("Arc PayLink escrow funding failed.");

      const localReference = {
        ...pendingReference,
        fundingHash: fundHash,
      };
      // Persist the secret-bearing recovery record before any optional server call.
      // A registration outage must never strand a funded escrow by losing its claim link.
      saveWalletlessPayLink(window.localStorage, localReference);
      let registrationWarning = "";
      try {
        setMessage("Escrow funded. Sign the free creator-recovery record; this does not move funds.");
        const managementToken = await registerWalletlessPayLink({ item: localReference, account, wallet: walletClient });
        saveWalletlessPayLink(window.localStorage, { ...localReference, managementToken });
      } catch {
        registrationWarning = " The funded link is safe in this browser, but private creator backup is temporarily unavailable.";
      }
      setClaimPackage(portablePackage);
      setStage("complete");
      setMessage(`Funded PayLink ready for ${normalizedEmail}. Copy or open the email draft below.${registrationWarning}`);
    } catch (error) {
      setStage("failed");
      setMessage(errorMessage(error));
    }
  }

  async function copyClaimLink() {
    if (!claimPackage) return;
    await navigator.clipboard.writeText(claimLink(window.location.origin, claimPackage));
    setCopiedLink(claimLink(window.location.origin, claimPackage));
    setMessage("Private claim link copied. Send it only to the intended recipient.");
  }

  function emailDraftUrl() {
    if (!claimPackage) return "#";
    const link = claimLink(window.location.origin, claimPackage);
    const subject = `You received ${claimPackage.amountUsdc} USDC on Arc`;
    const body = `${claimPackage.title ?? "Your payment"}\nReference: ${claimPackage.reference ?? "—"}\n\nClaim your ${claimPackage.amountUsdc} USDC payment:\n${link}\n\nTreat this private link like a payment secret.`;
    return `mailto:${encodeURIComponent(recipientEmail.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <section className="wallet-panel" aria-labelledby="tester-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Sender flow</p><h2 id="tester-heading">Create a walletless PayLink</h2></div>
        <span className="step">Funded escrow</span>
      </div>
      <p className="wallet-copy">Create and fund one isolated {ARC_NETWORK_NAME} escrow, then send its single-use claim link. Your wallet signs both transactions; Arc PayLink never receives its key. The link is a bearer secret, so send it only to the intended recipient.</p>
      {account && <dl className="payment-details wallet-details">
        <div><dt>Sender</dt><dd className="mono">{account.slice(0, 8)}…{account.slice(-6)}</dd></div>
        <div><dt>Amount</dt><dd>{claimPackage?.amountUsdc ?? amountUsdc} USDC</dd></div>
        {claimPackage && <div><dt>Escrow</dt><dd className="mono">{claimPackage.escrow.slice(0, 8)}…{claimPackage.escrow.slice(-6)}</dd></div>}
      </dl>}
      <div className={`status-box ${stage === "complete" ? "paid" : stage === "failed" ? "failed" : stage === "creating" || stage === "funding" ? "pending" : ""}`} role="status">
        <b>{message}</b>
        {(stage === "creating" || stage === "funding") && <span className="spinner" />}
      </div>
      {!account && <button className="primary-button full" onClick={connect}>Connect Arc wallet <span aria-hidden>→</span></button>}
      {account && !claimPackage && <form className="request-form compact" onSubmit={(event) => void createTesterPayLink(event)}>
        <label><span>Payment title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Logo delivery" required /></label>
        <label><span>Recipient email</span><input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} maxLength={254} placeholder="recipient@gmail.com" required /></label>
        <div className="field-row">
          <label><span>USDC amount</span><div className="amount-input"><input value={amountUsdc} onChange={(event) => setAmountUsdc(event.target.value)} inputMode="decimal" placeholder="100.00" required /><b>USDC</b></div></label>
          <label><span>Payment reference</span><input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={64} placeholder="INV-2026-014" required /></label>
        </div>
        <label><span>Claim expires</span><select value={lifetimeDays} onChange={(event) => setLifetimeDays(Number(event.target.value))}><option value={1}>In 1 day</option><option value={3}>In 3 days</option><option value={7}>In 7 days</option><option value={14}>In 14 days</option><option value={30}>In 30 days</option></select></label>
        <button className="primary-button full" disabled={stage === "creating" || stage === "funding"}>Create and fund PayLink <span aria-hidden>→</span></button>
      </form>}
      {claimPackage && <>
        <button className="primary-button full" onClick={() => void copyClaimLink()}>Copy private claim link <span aria-hidden>→</span></button>
        <a className="secondary-button full" href={emailDraftUrl()}>Open email draft <span aria-hidden>↗</span></a>
        {copiedLink && <p className="fine-print mono">Link copied for {recipientEmail.trim()}.</p>}
      </>}
      {creationHash && <a className="explorer-link" href={`${ARC_EXPLORER_URL}/tx/${creationHash}`} target="_blank" rel="noreferrer">View escrow creation on ArcScan ↗</a>}
      {fundingHash && <a className="explorer-link" href={`${ARC_EXPLORER_URL}/tx/${fundingHash}`} target="_blank" rel="noreferrer">View escrow funding on ArcScan ↗</a>}
      <p className="security-note">Treat this link like a payment secret. Automated email delivery and recipient-email binding are not yet enabled; whoever has the link can claim to their own verified Circle wallet.</p>
    </section>
  );
}
