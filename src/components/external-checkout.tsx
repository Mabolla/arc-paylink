"use client";
import { useRef, useState } from "react";
import { createWalletClient, custom, isHash, type Hash, type EIP1193Provider } from "viem";
import { ARC_CHAIN_ID, arcChainParameter } from "@/lib/arc";
import { COMMERCE_RPC_URL, commerceChain } from "@/lib/commerce/network";
import { connectWallet, getBrowserProvider } from "@/lib/browser-wallet";
import type { ExternalIntent } from "@/lib/commerce/external-payment";
import { externalPaymentMessage, externalTransaction } from "@/lib/commerce/external-payment";
import type { PublicOrder } from "@/lib/commerce/types";
import styles from "./business.module.css";

async function ensureCheckoutNetwork(provider: EIP1193Provider) {
  const target = `0x${ARC_CHAIN_ID.toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });
  if (current.toLowerCase() === target) return;
  try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target }] }); }
  catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ ...arcChainParameter, rpcUrls: [COMMERCE_RPC_URL] }] });
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...(body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to check payment. Keep your transaction hash and check again.");
  return result;
}

export function ExternalCheckout({ order, onPaid }: { order: PublicOrder; onPaid(order: PublicOrder): void }) {
  const [intent, setIntent] = useState<ExternalIntent>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [hash, setHash] = useState("");
  const guard = useRef(false);
  const path = `/api/checkout/${order.id}/external`;
  const savedHashKey = `arcpaylink.external.receipt.${order.id}`;

  async function review() {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError("");
    try {
      const provider = getBrowserProvider();
      const payer = await connectWallet(provider);
      await ensureCheckoutNetwork(provider);
      const result = await request<{ order: PublicOrder; reserved: boolean; intent?: ExternalIntent }>(`${path}?payer=${payer}`);
      if (result.order.status === "paid") { onPaid(result.order); return; }
      if (result.reserved) {
        setHash(localStorage.getItem(savedHashKey) ?? "");
        setNote("An attempt is already reserved. Paste its transaction hash below to verify it. Do not send another payment.");
        return;
      }
      if (!result.intent) throw new Error("Payment intent is unavailable.");
      setIntent(result.intent);
      setNote(`Pay from ${payer}. Your wallet will request a reservation signature, followed by the exact transfer approval.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to connect wallet."); }
    finally { guard.current = false; setBusy(false); }
  }

  async function confirm(transactionHash: Hash) {
    const result = await request<{ order: PublicOrder }>(path, { action: "confirm", transactionHash });
    if (result.order.status === "paid") { localStorage.removeItem(savedHashKey); onPaid(result.order); }
  }

  async function pay() {
    if (!intent || guard.current) return;
    guard.current = true; setBusy(true); setError("");
    const current = intent;
    setIntent(undefined);
    try {
      const provider = getBrowserProvider();
      await ensureCheckoutNetwork(provider);
      const account = await connectWallet(provider);
      if (account.toLowerCase() !== current.payer.toLowerCase()) throw new Error("Your wallet account changed. Review the purchase again.");
      const wallet = createWalletClient({ account: current.payer, chain: commerceChain, transport: custom(provider) });
      const signature = await wallet.signMessage({ message: externalPaymentMessage(order, current) });
      const result = await request<{ order: PublicOrder; alreadyReserved: boolean; transaction?: ReturnType<typeof externalTransaction> }>(path, { action: "reserve", ...current, signature });
      if (result.order.status === "paid") { onPaid(result.order); return; }
      if (result.alreadyReserved || !result.transaction) throw new Error("Payment is already reserved. Recover the transaction hash instead of paying again.");
      // Derive the transfer locally as well: server output cannot change the displayed purchase.
      const expected = externalTransaction(order, current.nonce);
      if (JSON.stringify(result.transaction) !== JSON.stringify(expected)) throw new Error("The transfer differs from the reviewed purchase.");
      setNote("Approve the exact transfer in your wallet. If the window closes, recover this payment by its transaction hash.");
      const transactionHash = await wallet.sendTransaction({ to: expected.to, data: expected.data, value: 0n, nonce: expected.nonce });
      setHash(transactionHash);
      localStorage.setItem(savedHashKey, transactionHash);
      setNote("Transfer submitted. Check the receipt after Arc confirms it; checking never sends funds.");
      await confirm(transactionHash);
    } catch (e) { setError(e instanceof Error ? e.message : "Check your wallet's transaction history before taking another action."); }
    finally { guard.current = false; setBusy(false); }
  }

  async function check() {
    if (!isHash(hash) || guard.current) return;
    guard.current = true; setBusy(true); setError("");
    try { await confirm(hash); }
    catch (e) { setError(e instanceof Error ? e.message : "Receipt is not ready. Check again after confirmation."); }
    finally { guard.current = false; setBusy(false); }
  }

  return <details className={styles.note}>
    <summary>Already have an Arc wallet?</summary>
    <p>Connect your existing EVM wallet. The same order and business receipt are used. You approve every transfer; Arc PayLink never receives your private key.</p>
    {error && <div className={styles.alert} role="alert">{error}</div>}
    {note && <p role="status">{note}</p>}
    <div className={styles.form}>
      {intent ? <button className={styles.button} disabled={busy} onClick={() => void pay()}>Approve {order.amount} USDC in wallet →</button>
        : <button className={styles.secondary} disabled={busy} onClick={() => void review()}>Connect and review existing wallet</button>}
      <label>Already sent this payment? Transaction hash
        <input value={hash} onChange={(e) => setHash(e.target.value.trim())} placeholder="0x…" autoComplete="off" spellCheck={false} />
      </label>
      <button className={styles.secondary} disabled={busy || !isHash(hash)} onClick={() => void check()}>Verify existing payment</button>
    </div>
  </details>;
}
