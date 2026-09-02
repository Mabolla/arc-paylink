"use client";

import { useMemo, useState } from "react";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, formatUnits, http, type Address, type Hash } from "viem";
import { ARC_EXPLORER_URL, arcTestnet } from "@/lib/arc";
import { connectWallet, ensureArcTestnet, getBrowserProvider } from "@/lib/browser-wallet";
import { executeBridgePayment } from "@/lib/bridge-payment";
import type { PaymentRequest } from "@/lib/payment-request";
import { settlePaymentRequest, type PaymentSettlementResult } from "@/lib/settle-payment-request";
import { verifyPaymentReceipt, type VerificationResult } from "@/lib/verify-payment";
import { saveSettlementRecord, saveSettlementRecordOnServer, settlementRecordJson, type SharedStoreResult, type StoreResult } from "@/lib/settlement-record-store";

type Status = "ready" | "connected" | "pending" | "bridge_processing" | "paid" | "settled" | "failed";

export function PaymentPanel({ title, amount, recipient, route, obligation, requestId }: PaymentRequest & { requestId?: string }) {
  const [status, setStatus] = useState<Status>("ready");
  const [account, setAccount] = useState<Address>();
  const [message, setMessage] = useState("Connect an Arc wallet to continue.");
  const [result, setResult] = useState<VerificationResult>();
  const [settlement, setSettlement] = useState<PaymentSettlementResult>();
  const [auditStatus, setAuditStatus] = useState<StoreResult | "unavailable">();
  const [sharedAuditStatus, setSharedAuditStatus] = useState<SharedStoreResult>();
  const client = useMemo(() => createPublicClient({ chain: arcTestnet, transport: http() }), []);

  async function connect() {
    try {
      const provider = getBrowserProvider();
      const address = await connectWallet(provider);
      if (route === "arc") await ensureArcTestnet(provider);
      setAccount(address);
      setStatus("connected");
      setMessage(route === "arc" ? "Wallet connected on Arc Testnet. Review and submit the payment." : "Wallet connected. Review the Base Sepolia bridge payment.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function pay() {
    try {
      if (requestId) await assertManagedPayable(requestId);
      if (route === "bridge") {
        setStatus("bridge_processing");
        setMessage("Approve the Circle Bridge transactions. Waiting for the destination mint on Arc.");
        const bridgeResult = await executeBridgePayment({ provider: getBrowserProvider(), recipient, amount });
        const mint = bridgeResult.steps.find((step) => step.name.toLowerCase() === "mint");
        if (!mint?.txHash) throw new Error("Circle Bridge completed without a destination mint transaction hash.");
        setMessage("Destination mint submitted. Verifying the exact Arc settlement.");
        const destinationReceipt = await client.waitForTransactionReceipt({ hash: mint.txHash as Hash });
        const settled = settlePaymentRequest({ request: { title, amount, recipient, route, obligation }, bridgeResult, destinationReceipt });
        let saved: StoreResult | "unavailable" | undefined;
        if (settled.correlation) {
          try {
            saved = saveSettlementRecord(window.localStorage, settled.correlation);
          } catch {
            saved = "unavailable";
          }
        }
        setAuditStatus(saved);
        setSettlement(settled);
        setResult({ transactionHash: settled.mintTransactionHash, blockNumber: settled.blockNumber, sender: settled.sender, recipient: settled.recipient, amountBaseUnits: settled.amountBaseUnits });
        setStatus("settled");
        setMessage(saved === "conflict" ? "Payment settled, but a conflicting local audit record requires manual review." : saved === "unavailable" ? "Payment settled; download the audit record because browser persistence is unavailable." : settled.paymentState === "fee-adjusted" ? "Obligation settled on Arc with a recorded bridge fee." : "Obligation settled and verified on Arc Testnet.");
        if (settled.correlation) {
          setSharedAuditStatus(undefined);
          void saveSettlementRecordOnServer(settled.correlation).then(setSharedAuditStatus);
        }
        if (requestId) await recordManagedSettlement(requestId, settled.mintTransactionHash, settled.correlation?.correlationId);
        return;
      }
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
      if (requestId) await recordManagedSettlement(requestId, hash);
      setResult(verified);
      setStatus("paid");
      setMessage("Payment verified on Arc Testnet.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Payment failed.");
    }
  }

  async function assertManagedPayable(id: string) { const response = await fetch(`/api/requests/${id}`, { cache: "no-store" }); const result = await response.json() as { view?: { status?: string } }; if (!response.ok || result.view?.status !== "pending") throw new Error("This request is no longer pending and cannot be paid."); }

  async function recordManagedSettlement(id: string, transactionHash: Hash, correlationId?: Hash) { const response = await fetch(`/api/requests/${id}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionHash, correlationId }) }); if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error ?? "The payment succeeded but request settlement visibility could not be updated."); } }

  function downloadAuditRecord() {
    if (!settlement?.correlation) return;
    const blob = new Blob([settlementRecordJson(settlement.correlation)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const safeId = settlement.correlation.obligation.id.replace(/[^A-Za-z0-9._-]/g, "-");
    anchor.download = `arc-paylink-${safeId}-settlement.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="payment-panel">
      <div className="receipt-top"><span className={`status-dot ${status}`} /><span>{status === "paid" ? "Paid" : status === "settled" ? "Settled" : status === "pending" || status === "bridge_processing" ? "Processing" : status === "failed" ? "Action needed" : "Awaiting payment"}</span></div>
      <p className="eyebrow">Payment request</p>
      <h1 className="payment-title">{title}</h1>
      <div className="payment-amount"><strong>{amount}</strong><span>USDC</span></div>
      <dl className="payment-details">
        <div><dt>Route</dt><dd>{route === "bridge" ? "Base Sepolia → Arc Testnet" : "Arc Testnet"}</dd></div>
        <div><dt>Recipient</dt><dd className="mono">{recipient.slice(0, 8)}…{recipient.slice(-6)}</dd></div>
        {obligation && <div><dt>{obligation.kind.replace("-", " ")}</dt><dd className="mono">{obligation.id}</dd></div>}
        {account && <div><dt>Paying from</dt><dd className="mono">{account.slice(0, 8)}…{account.slice(-6)}</dd></div>}
        {settlement && <div><dt>Settlement state</dt><dd>{settlement.paymentState.replace("-", " ")}</dd></div>}
        {settlement && <div><dt>Gross / recipient net</dt><dd>{formatUnits(settlement.grossAmountBaseUnits, 6)} / {formatUnits(settlement.amountBaseUnits, 6)} USDC</dd></div>}
        {settlement && settlement.bridgeFeeBaseUnits > 0n && <div><dt>Recorded bridge fee</dt><dd>{formatUnits(settlement.bridgeFeeBaseUnits, 6)} USDC</dd></div>}
        {settlement?.correlation && <div><dt>Correlation ID</dt><dd className="mono">{settlement.correlation.correlationId.slice(0, 10)}…{settlement.correlation.correlationId.slice(-8)}</dd></div>}
        {settlement?.correlation && <div><dt>Recovery plan</dt><dd>{settlement.correlation.settlement.recoveryAction.replaceAll("-", " ")}</dd></div>}
        {auditStatus && <div><dt>Audit record</dt><dd>{auditStatus === "created" ? "saved locally" : auditStatus === "unchanged" ? "already verified" : auditStatus === "conflict" ? "conflict · manual review" : "download required"}</dd></div>}
        {settlement?.correlation && <div><dt>Shared audit record</dt><dd>{!sharedAuditStatus ? "saving…" : sharedAuditStatus === "created" ? "saved immutably" : sharedAuditStatus === "unchanged" ? "already verified" : sharedAuditStatus === "conflict" ? "conflict · manual review" : sharedAuditStatus === "not-configured" ? "server storage not connected" : "temporarily unavailable"}</dd></div>}
      </dl>
      <div className={`status-box ${status}`} role="status"><b>{message}</b>{(status === "pending" || status === "bridge_processing") && <span className="spinner" />}</div>
      {!account && <button className="primary-button full" onClick={connect}>Connect wallet</button>}
      {account && status !== "paid" && status !== "settled" && status !== "pending" && status !== "bridge_processing" && <button className="primary-button full" onClick={pay}>Pay {amount} USDC <span aria-hidden>→</span></button>}
      {status === "failed" && !account && <button className="text-button" onClick={connect}>Try connection again</button>}
      {result && <a className="explorer-link" href={`${ARC_EXPLORER_URL}/tx/${result.transactionHash}`} target="_blank" rel="noreferrer">View verified transaction on ArcScan ↗</a>}
      {settlement?.correlation && <button className="text-button" onClick={downloadAuditRecord}>Download settlement audit record</button>}
      <p className="security-note">Your wallet signs the transaction. Arc PayLink never receives your keys.</p>
    </section>
  );
}
