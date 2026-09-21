"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  formatUnits,
  http,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { ARC_EXPLORER_URL, ARC_NETWORK_NAME, ARC_USDC_ADDRESS, arcChain } from "@/lib/arc";
import { connectWallet, ensureArcNetwork, getBrowserProvider } from "@/lib/browser-wallet";
import { claimLink } from "@/lib/claim-link";
import { saveWalletlessPayLink, walletlessPayLinks, type WalletlessPayLinkReference } from "@/lib/walletless-paylink-client";
import { registerWalletlessPayLink } from "@/lib/walletless-registration-client";
import { isSurplusSafeArcPayLinkFactory, isTrustedArcPayLinkFactory } from "@/lib/claim-package";
import {
  decryptClaimBackup,
  recoveryManagementToken,
  walletlessRecoveryMessage,
  type EncryptedClaimBackup,
} from "@/lib/walletless-recovery";
import { outstandingFunding, walletlessStatus, type WalletlessStatus } from "@/lib/walletless-state";

const escrowAbi = parseAbi([
  "function state() view returns (uint8)",
  "function refund()",
  "function recoverSurplus()",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);

type Item = WalletlessPayLinkReference & { status: WalletlessStatus; escrowBalance: bigint | null };

function emailDraft(item: WalletlessPayLinkReference) {
  const payment = item.claimPackage;
  const link = claimLink(window.location.origin, payment);
  const subject = `You received ${payment.amountUsdc} USDC on Arc`;
  const body = `${payment.title ?? "Your payment"}\nReference: ${payment.reference ?? "—"}\n\nClaim your ${payment.amountUsdc} USDC payment:\n${link}\n\nTreat this private link like a payment secret.`;
  return `mailto:${encodeURIComponent(item.recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function WalletlessRequests() {
  const client = useMemo(() => createPublicClient({ chain: arcChain, transport: http() }), []);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("");
  const [busyEscrow, setBusyEscrow] = useState<Address>();
  const [recoveryPaymentId, setRecoveryPaymentId] = useState("");
  const [recovering, setRecovering] = useState(false);

  const refresh = useCallback(async () => {
    const saved = walletlessPayLinks(window.localStorage);
    const resolved = await Promise.all(saved.map(async (item) => {
      const [state, escrowBalance] = await Promise.all([
        client.readContract({
          address: getAddress(item.claimPackage.escrow),
          abi: escrowAbi,
          functionName: "state",
        }).catch(() => null),
        client.readContract({
          address: ARC_USDC_ADDRESS,
          abi: usdcAbi,
          functionName: "balanceOf",
          args: [getAddress(item.claimPackage.escrow)],
        }).catch(() => null),
      ]);
      return { ...item, status: walletlessStatus(state, item.claimPackage.expiry, escrowBalance), escrowBalance } as Item;
    }));
    setItems(resolved);
  }, [client]);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);

  async function copy(item: Item) {
    await navigator.clipboard.writeText(claimLink(window.location.origin, item.claimPackage));
    setMessage(`Private claim link copied for ${item.recipientEmail}.`);
  }

  async function refund(item: Item) {
    try {
      setBusyEscrow(item.claimPackage.escrow);
      setMessage("Connect the original sender wallet and approve the refund.");
      const provider = getBrowserProvider();
      const account = await connectWallet(provider);
      await ensureArcNetwork(provider);
      if (account.toLowerCase() !== item.sender.toLowerCase()) throw new Error("Connect the wallet that created this PayLink.");
      const wallet = createWalletClient({ account, chain: arcChain, transport: custom(provider) });
      const hash = await wallet.writeContract({ address: item.claimPackage.escrow, abi: escrowAbi, functionName: "refund" });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The refund transaction failed.");
      setMessage(`Refund confirmed on ${ARC_NETWORK_NAME}: ${hash.slice(0, 10)}…`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refund failed.");
    } finally {
      setBusyEscrow(undefined);
    }
  }

  async function recoverSurplus(item: Item) {
    try {
      setBusyEscrow(item.claimPackage.escrow);
      setMessage("Connect the original sender wallet and recover the unreserved escrow balance.");
      const provider = getBrowserProvider();
      const account = await connectWallet(provider);
      await ensureArcNetwork(provider);
      if (account.toLowerCase() !== item.sender.toLowerCase()) throw new Error("Connect the wallet that created this PayLink.");
      const wallet = createWalletClient({ account, chain: arcChain, transport: custom(provider) });
      const hash = await wallet.writeContract({ address: item.claimPackage.escrow, abi: escrowAbi, functionName: "recoverSurplus" });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The surplus recovery transaction failed.");
      setMessage(`Surplus recovery confirmed on ${ARC_NETWORK_NAME}: ${hash.slice(0, 10)}…`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Surplus recovery failed.");
    } finally {
      setBusyEscrow(undefined);
    }
  }

  async function fund(item: Item) {
    try {
      setBusyEscrow(item.claimPackage.escrow);
      setMessage("Connect the original sender wallet and approve the exact escrow funding.");
      const provider = getBrowserProvider();
      const account = await connectWallet(provider);
      await ensureArcNetwork(provider);
      if (account.toLowerCase() !== item.sender.toLowerCase()) throw new Error("Connect the wallet that created this PayLink.");
      const targetAmount = BigInt(item.claimPackage.amountBaseUnits);
      const currentBalance = await client.readContract({ address: ARC_USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [item.claimPackage.escrow] });
      const amount = outstandingFunding(targetAmount, currentBalance);
      if (amount === 0n) {
        setMessage("This escrow already has the required USDC balance.");
        await refresh();
        return;
      }
      const balance = await client.readContract({ address: ARC_USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [account] });
      if (balance < amount) throw new Error(`Your wallet does not have enough ${ARC_NETWORK_NAME} USDC.`);
      const wallet = createWalletClient({ account, chain: arcChain, transport: custom(provider) });
      const hash = await wallet.writeContract({ address: ARC_USDC_ADDRESS, abi: usdcAbi, functionName: "transfer", args: [item.claimPackage.escrow, amount] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The funding transaction failed.");
      const fundedItem = { ...item, fundingHash: hash };
      saveWalletlessPayLink(window.localStorage, fundedItem);
      let registrationWarning = "";
      try {
        setMessage("Funding confirmed. Sign the free creator-recovery record; this does not move funds.");
        const managementToken = await registerWalletlessPayLink({ item: fundedItem, account, wallet });
        saveWalletlessPayLink(window.localStorage, { ...fundedItem, managementToken });
      } catch (error) {
        registrationWarning = ` Encrypted creator backup was not saved: ${error instanceof Error ? error.message : "creator registration failed"}. You can retry below.`;
      }
      setMessage(`Funding confirmed on ${ARC_NETWORK_NAME}. The private claim link is now active.${registrationWarning}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Funding failed.");
    } finally {
      setBusyEscrow(undefined);
    }
  }

  async function registerBackup(item: Item) {
    try {
      setBusyEscrow(item.claimPackage.escrow);
      if (!item.fundingHash) throw new Error("Funding transaction evidence is missing from this browser.");
      setMessage("Connect the original sender wallet and sign the free creator-backup records. These signatures cannot move funds.");
      const provider = getBrowserProvider();
      const account = await connectWallet(provider);
      await ensureArcNetwork(provider);
      if (account.toLowerCase() !== item.sender.toLowerCase()) throw new Error("Connect the wallet that created this PayLink.");
      const wallet = createWalletClient({ account, chain: arcChain, transport: custom(provider) });
      const managementToken = await registerWalletlessPayLink({ item: { ...item, fundingHash: item.fundingHash }, account, wallet });
      saveWalletlessPayLink(window.localStorage, { ...item, managementToken });
      setMessage("Encrypted creator backup saved. This PayLink can now be recovered in a new browser with the original sender wallet.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Creator backup registration failed.");
    } finally {
      setBusyEscrow(undefined);
    }
  }

  async function recover() {
    try {
      setRecovering(true);
      const paymentId = recoveryPaymentId.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(paymentId)) throw new Error("Enter the 32-byte PayLink payment ID.");
      setMessage("Loading the encrypted recovery context.");
      const contextResponse = await fetch(`/api/walletless/${encodeURIComponent(paymentId)}`, { cache: "no-store" });
      const contextResult = await contextResponse.json() as {
        recovery?: { factory: Address; paymentId: Hex; escrow: Address; sender: Address };
        error?: string;
      };
      if (!contextResponse.ok || !contextResult.recovery) throw new Error(contextResult.error ?? "Recoverable PayLink not found.");
      const recoveryContext = contextResult.recovery;
      if (!isTrustedArcPayLinkFactory(recoveryContext.factory)) throw new Error("Recovery record uses an untrusted factory.");

      const provider = getBrowserProvider();
      const account = await connectWallet(provider);
      await ensureArcNetwork(provider);
      if (account.toLowerCase() !== recoveryContext.sender.toLowerCase()) throw new Error("Connect the wallet that created this PayLink.");
      const wallet = createWalletClient({ account, chain: arcChain, transport: custom(provider) });
      setMessage("Sign the free recovery message. This cannot move funds.");
      const recoverySignature = await wallet.signMessage({ account, message: walletlessRecoveryMessage(recoveryContext) });
      const managementToken = recoveryManagementToken(recoverySignature);
      const recordResponse = await fetch(`/api/walletless/${encodeURIComponent(paymentId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managementToken }),
      });
      const recordResult = await recordResponse.json() as {
        view?: {
          sender: Address;
          recipientEmail: string;
          creationHash: Hash;
          fundingHash: Hash;
          createdAt: string;
          encryptedClaimBackup?: EncryptedClaimBackup;
        };
        error?: string;
      };
      if (!recordResponse.ok || !recordResult.view?.encryptedClaimBackup) throw new Error(recordResult.error ?? "Encrypted creator backup is unavailable.");
      const claimPackage = await decryptClaimBackup(recordResult.view.encryptedClaimBackup, recoverySignature, recoveryContext);
      if (claimPackage.paymentId.toLowerCase() !== paymentId.toLowerCase()) throw new Error("Recovered claim package does not match the requested PayLink.");
      saveWalletlessPayLink(window.localStorage, {
        sender: account,
        recipientEmail: recordResult.view.recipientEmail,
        createdAt: recordResult.view.createdAt,
        creationHash: recordResult.view.creationHash,
        fundingHash: recordResult.view.fundingHash,
        claimPackage,
        managementToken,
      });
      setRecoveryPaymentId("");
      setMessage("PayLink recovered to this browser and revalidated from Arc.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PayLink recovery failed.");
    } finally {
      setRecovering(false);
    }
  }

  return <section className="walletless-list">
    <div className="panel-heading"><div><p className="eyebrow">Funded escrow payments</p><h2>Walletless PayLinks</h2></div></div>
    {message && <div className="status-box"><b>{message}</b></div>}
    <div className="request-card">
      <p className="eyebrow">New browser or cleared storage</p>
      <h2>Recover a creator PayLink</h2>
      <p className="wallet-copy">Enter its payment ID, connect the original sender wallet, and sign a free recovery message. The encrypted claim secret is decrypted only in this browser.</p>
      <label><span>Payment ID</span><input className="mono" value={recoveryPaymentId} onChange={(event) => setRecoveryPaymentId(event.target.value)} placeholder="0x…" /></label>
      <button className="secondary-button full" disabled={recovering} onClick={() => void recover()}>{recovering ? "Recovering…" : "Recover PayLink"}</button>
    </div>
    {items.map((item) => <article className="request-card" key={item.claimPackage.paymentId}>
      <div className="receipt-top"><span className={`status-dot ${item.status === "claimed" || item.status === "refunded" ? "paid" : item.status === "unavailable" ? "failed" : "pending"}`} /><span>{item.status}</span></div>
      <h2>{item.claimPackage.title ?? "Walletless payment"}</h2>
      <dl className="payment-details">
        <div><dt>Amount</dt><dd>{item.claimPackage.amountUsdc} USDC</dd></div>
        <div><dt>Recipient</dt><dd>{item.recipientEmail}</dd></div>
        <div><dt>Reference</dt><dd className="mono">{item.claimPackage.reference ?? "—"}</dd></div>
        <div><dt>Expires</dt><dd>{new Date(item.claimPackage.expiry).toLocaleString()}</dd></div>
        <div><dt>Escrow</dt><dd className="mono">{item.claimPackage.escrow.slice(0, 8)}…{item.claimPackage.escrow.slice(-6)}</dd></div>
      </dl>
      {(item.status === "awaiting funds" || item.status === "partially funded") && <>
        {item.escrowBalance !== null && item.escrowBalance > 0n && <p className="fine-print">Received {formatUnits(item.escrowBalance, 6)} USDC; {formatUnits(BigInt(item.claimPackage.amountBaseUnits) - item.escrowBalance, 6)} USDC remains.</p>}
        <button className="primary-button full" disabled={busyEscrow === item.claimPackage.escrow} onClick={() => void fund(item)}>Fund remaining amount <span aria-hidden>→</span></button>
      </>}
      {item.status === "funded" && <>
        <button className="secondary-button full" onClick={() => void copy(item)}>Copy private claim link</button>
        <a className="text-button" href={emailDraft(item)}>Open email draft</a>
      </>}
      {item.status === "expired" && (isSurplusSafeArcPayLinkFactory(item.claimPackage.factory) || (item.escrowBalance ?? 0n) >= BigInt(item.claimPackage.amountBaseUnits)) && <button className="primary-button full" disabled={busyEscrow === item.claimPackage.escrow} onClick={() => void refund(item)}>Refund to sender <span aria-hidden>→</span></button>}
      {item.status === "expired" && !isSurplusSafeArcPayLinkFactory(item.claimPackage.factory) && (item.escrowBalance ?? 0n) > 0n && (item.escrowBalance ?? 0n) < BigInt(item.claimPackage.amountBaseUnits) && <p className="fine-print">This legacy escrow expired before it was fully funded. Its earlier contract version cannot return a partial balance.</p>}
      {(item.status === "claimed" || item.status === "refunded") && item.escrowBalance !== null && item.escrowBalance > 0n && isSurplusSafeArcPayLinkFactory(item.claimPackage.factory) && <button className="secondary-button full" disabled={busyEscrow === item.claimPackage.escrow} onClick={() => void recoverSurplus(item)}>Recover {formatUnits(item.escrowBalance, 6)} surplus USDC</button>}
      {(item.status === "claimed" || item.status === "refunded") && item.escrowBalance !== null && item.escrowBalance > 0n && !isSurplusSafeArcPayLinkFactory(item.claimPackage.factory) && <p className="fine-print">This legacy escrow contains an unrecoverable surplus from its earlier contract version.</p>}
      {!item.managementToken && item.fundingHash && <button className="secondary-button full" disabled={busyEscrow === item.claimPackage.escrow} onClick={() => void registerBackup(item)}>Save encrypted creator backup</button>}
      <a className="explorer-link mono" href={`${ARC_EXPLORER_URL}/address/${item.claimPackage.escrow}`} target="_blank" rel="noreferrer">View escrow on ArcScan ↗</a>
    </article>)}
  </section>;
}
