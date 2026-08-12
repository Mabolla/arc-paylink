"use client";

import { useMemo, useState } from "react";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http, type Address, type Hash } from "viem";
import { ARC_EXPLORER_URL, arcTestnet } from "@/lib/arc";
import { connectWallet, ensureArcTestnet, getBrowserProvider } from "@/lib/browser-wallet";
import { verifyPaymentReceipt, type VerificationResult } from "@/lib/verify-payment";

type Status = "ready" | "connected" | "pending" | "paid" | "failed";

export function PaymentPanel({ title, amount, recipient }: { title: string; amount: string; recipient: Address }) {
  const [status, setStatus] = useState<Status>("ready");
  const [account, setAccount] = useState<Address>();
  const [message, setMessage] = useState("Connect an Arc wallet to continue.");
  const [result, setResult] = useState<VerificationResult>();
  const client = useMemo(() => createPublicClient({ chain: arcTestnet, transport: http() }), []);

  async function connect() {
    try {
      const provider = getBrowserProvider();
      const address = await connectWallet(provider);
      await ensureArcTestnet(provider);
      setAccount(address);
      setStatus("connected");
      setMessage("Wallet connected on Arc Testnet. Review and submit the payment.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function pay() {
    try {
      setStatus("pending");
      setMessage("Approve the USDC transfer in your wallet. Then wait for Arc confirmation.");
      const provider = getBrowserProvider();
      await ensureArcTestnet(provider);
      const adapter = await createViemAdapterFromProvider({ provider });
      const kit = new AppKit();
      const send = await kit.send({ from: { adapter, chain: "Arc_Testnet" }, to: recipient, amount, token: "USDC" });
      const hash = send.txHash as Hash | undefined;
      if (!hash) throw new Error("Circle App Kit completed without returning a transaction hash.");
      setMessage("Transaction submitted. Verifying the Arc receipt and exact USDC transfer.");
      const verified = await verifyPaymentReceipt(client, hash, { recipient, amount });
      setResult(verified);
      setStatus("paid");
      setMessage("Payment verified on Arc Testnet.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Payment failed.");
    }
  }

  return (
    <section className="payment-panel">
      <div className="receipt-top"><span className={`status-dot ${status}`} /><span>{status === "paid" ? "Paid" : status === "pending" ? "Pending" : status === "failed" ? "Action needed" : "Awaiting payment"}</span></div>
      <p className="eyebrow">Payment request</p>
      <h1 className="payment-title">{title}</h1>
      <div className="payment-amount"><strong>{amount}</strong><span>USDC</span></div>
      <dl className="payment-details">
        <div><dt>Network</dt><dd>Arc Testnet <span className="network-id">5042002</span></dd></div>
        <div><dt>Recipient</dt><dd className="mono">{recipient.slice(0, 8)}…{recipient.slice(-6)}</dd></div>
        {account && <div><dt>Paying from</dt><dd className="mono">{account.slice(0, 8)}…{account.slice(-6)}</dd></div>}
      </dl>
      <div className={`status-box ${status}`} role="status"><b>{message}</b>{status === "pending" && <span className="spinner" />}</div>
      {!account && <button className="primary-button full" onClick={connect}>Connect wallet</button>}
      {account && status !== "paid" && status !== "pending" && <button className="primary-button full" onClick={pay}>Pay {amount} USDC <span aria-hidden>→</span></button>}
      {status === "failed" && !account && <button className="text-button" onClick={connect}>Try connection again</button>}
      {result && <a className="explorer-link" href={`${ARC_EXPLORER_URL}/tx/${result.transactionHash}`} target="_blank" rel="noreferrer">View verified transaction on ArcScan ↗</a>}
      <p className="security-note">Your wallet signs the transaction. Arc PayLink never receives your keys.</p>
    </section>
  );
}
