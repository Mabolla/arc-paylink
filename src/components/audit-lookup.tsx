"use client";

import { useState, type FormEvent } from "react";
import type { SettlementCorrelationRecord } from "@/lib/settlement-correlation";

type LookupState = "ready" | "loading" | "verified" | "not-found" | "conflict" | "failed";

export function AuditLookup() {
  const [state, setState] = useState<LookupState>("ready");
  const [message, setMessage] = useState("Use the exact correlation ID and obligation reference from the payment receipt.");
  const [record, setRecord] = useState<SettlementCorrelationRecord>();

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setRecord(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/settlements/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          correlationId: data.get("correlationId"),
          obligationKind: data.get("obligationKind"),
          obligationId: data.get("obligationId"),
        }),
      });
      const result = (await response.json()) as { state?: string; error?: string; record?: SettlementCorrelationRecord };
      if (response.ok && result.record) {
        setRecord(result.record);
        setState("verified");
        setMessage("Immutable shared audit record verified.");
      } else if (result.state === "not-found") {
        setState("not-found");
        setMessage("No record matched both references. Nothing was disclosed.");
      } else if (result.state === "conflict") {
        setState("conflict");
        setMessage("Multiple records require manual review; no record was disclosed.");
      } else {
        setState("failed");
        setMessage(result.error ?? "Settlement lookup failed.");
      }
    } catch {
      setState("failed");
      setMessage("Settlement lookup is temporarily unavailable.");
    }
  }

  return (
    <section className="audit-panel">
      <form className="request-form" onSubmit={lookup}>
        <label>Correlation ID<input name="correlationId" placeholder="0x…" pattern="0x[0-9a-fA-F]{64}" required /></label>
        <div className="field-row">
          <label>Obligation type<select name="obligationKind" defaultValue="invoice"><option value="invoice">Invoice</option><option value="milestone">Milestone</option><option value="agent-task">Agent task</option></select></label>
          <label>Obligation ID<input name="obligationId" placeholder="INV-2026-001" maxLength={64} required /></label>
        </div>
        <button className="primary-button full" disabled={state === "loading"}>Verify shared record <span aria-hidden>→</span></button>
      </form>
      <div className={`status-box ${state === "verified" ? "paid" : state === "ready" || state === "loading" ? "" : "failed"}`} role="status"><b>{message}</b>{state === "loading" && <span className="spinner" />}</div>
      {record && <dl className="payment-details audit-result">
        <div><dt>Settlement state</dt><dd>{record.settlement.state.replaceAll("-", " ")}</dd></div>
        <div><dt>Recovery plan</dt><dd>{record.settlement.recoveryAction.replaceAll("-", " ")}</dd></div>
        <div><dt>Base burn</dt><dd className="mono">{record.source.burnTransactionHash.slice(0, 10)}…{record.source.burnTransactionHash.slice(-8)}</dd></div>
        <div><dt>Arc mint</dt><dd className="mono">{record.destination.mintTransactionHash.slice(0, 10)}…{record.destination.mintTransactionHash.slice(-8)}</dd></div>
        <div><dt>Gross / recipient</dt><dd className="mono">{record.settlement.grossAmountBaseUnits} / {record.settlement.recipientAmountBaseUnits}</dd></div>
        <div><dt>Audit events</dt><dd>{record.events.length} verified</dd></div>
      </dl>}
      <p className="security-note">Both references must match. Blob URLs and raw CCTP proof bytes are never exposed.</p>
    </section>
  );
}
