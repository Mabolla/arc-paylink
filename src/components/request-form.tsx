"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createPaymentRequest } from "@/lib/payment-request";

export function RequestForm() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const paymentRequest = createPaymentRequest({
        title: String(form.get("title") ?? ""),
        amount: String(form.get("amount") ?? ""),
        recipient: String(form.get("recipient") ?? ""),
        route: String(form.get("route") ?? ""),
        obligationKind: String(form.get("obligationKind") ?? ""),
        obligationId: String(form.get("obligationId") ?? ""),
      });
      const response = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...paymentRequest, obligationKind: paymentRequest.obligation?.kind, obligationId: paymentRequest.obligation?.id }) });
      const result = await response.json() as { requestId?: string; managementToken?: string; error?: string };
      if (!response.ok || !result.requestId || !result.managementToken) throw new Error(result.error ?? "Could not create the managed request.");
      const { saveManagedRequestReference } = await import("@/lib/managed-request-client");
      saveManagedRequestReference(window.localStorage, { requestId: result.requestId, managementToken: result.managementToken });
      router.push(`/pay/${result.requestId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the request.");
    }
  }

  return (
    <form className="request-form" onSubmit={submit}>
      <label>
        <span>Payment title</span>
        <input name="title" placeholder="Website delivery" maxLength={80} required />
      </label>
      <div className="field-row">
        <label>
          <span>USDC amount</span>
          <div className="amount-input"><input name="amount" inputMode="decimal" placeholder="250.00" required /><b>USDC</b></div>
        </label>
        <label className="recipient-field">
          <span>Recipient wallet</span>
          <input name="recipient" placeholder="0x..." spellCheck={false} required />
        </label>
      </div>
      <label>
        <span>Payment route</span>
        <select name="route" defaultValue="arc">
          <option value="arc">Arc Testnet wallet</option>
          <option value="bridge">Base Sepolia via Circle Bridge</option>
        </select>
      </label>
      <div className="field-row">
        <label>
          <span>Business obligation</span>
          <select name="obligationKind" defaultValue="invoice" required>
            <option value="invoice">Invoice</option>
            <option value="milestone">Milestone</option>
            <option value="agent-task">Agent task</option>
          </select>
        </label>
        <label>
          <span>Obligation ID</span>
          <input name="obligationId" placeholder="INV-2026-001" maxLength={64} required />
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit">Create payment link <span aria-hidden>→</span></button>
    </form>
  );
}
