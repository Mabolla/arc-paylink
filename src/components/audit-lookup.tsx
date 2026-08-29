"use client";

import { useState, type FormEvent } from "react";
import { formatUnits } from "viem";
import type { ControlledRecoveryPlan } from "@/lib/recovery-plan";
import type { SettlementCorrelationRecord } from "@/lib/settlement-correlation";

type LookupState = "ready" | "loading" | "verified" | "not-found" | "conflict" | "failed";

export function AuditLookup() {
  const [state, setState] = useState<LookupState>("ready");
  const [message, setMessage] = useState("Use the exact correlation ID and obligation reference from the payment receipt.");
  const [record, setRecord] = useState<SettlementCorrelationRecord>();
  const [recoveryPlan, setRecoveryPlan] = useState<ControlledRecoveryPlan>();
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setRecord(undefined);
    setRecoveryPlan(undefined);
    setRecoveryMessage("");
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

  async function prepareRecovery() {
    if (!record) return;
    setRecoveryLoading(true);
    setRecoveryPlan(undefined);
    setRecoveryMessage("");
    try {
      const response = await fetch("/api/settlements/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          correlationId: record.correlationId,
          obligationKind: record.obligation.kind,
          obligationId: record.obligation.id,
          paymentReference: record.source.burnTransactionHash,
        }),
      });
      const result = (await response.json()) as { error?: string; plan?: ControlledRecoveryPlan };
      if (result.plan) {
        setRecoveryPlan(result.plan);
        setRecoveryMessage(result.plan.instruction);
      } else {
        setRecoveryMessage(result.error ?? "Recovery planning failed without disclosing settlement data.");
      }
    } catch {
      setRecoveryMessage("Recovery planning is temporarily unavailable.");
    } finally {
      setRecoveryLoading(false);
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
      {record && !recoveryPlan && <button className="secondary-button full" type="button" onClick={prepareRecovery} disabled={recoveryLoading}>
        {recoveryLoading ? "Preparing controlled plan…" : "Prepare controlled recovery"}<span aria-hidden>→</span>
      </button>}
      {recoveryMessage && <div className={`status-box ${recoveryPlan ? recoveryPlan.status === "no-action" ? "paid" : recoveryPlan.status === "ready" ? "pending" : "failed" : "failed"}`} role="status">
        <b>{recoveryMessage}</b>{recoveryLoading && <span className="spinner" />}
      </div>}
      {recoveryPlan && <section className="recovery-plan" aria-label="Controlled recovery plan">
        <div className="recovery-guard"><b>No transaction created</b><span>No funds moved</span></div>
        <dl className="payment-details">
          <div><dt>Plan status</dt><dd>{recoveryPlan.status.replaceAll("-", " ")}</dd></div>
          <div><dt>Action</dt><dd>{recoveryPlan.action.replaceAll("-", " ")}</dd></div>
          <div><dt>Outstanding</dt><dd>{formatUnits(BigInt(recoveryPlan.outstandingBaseUnits), 6)} USDC</dd></div>
          <div><dt>Plan ID</dt><dd className="mono">{recoveryPlan.planId.slice(0, 10)}…{recoveryPlan.planId.slice(-8)}</dd></div>
        </dl>
        <p className="security-note">This deterministic plan is read-only. It cannot retry, refund, top up, or execute a transaction.</p>
      </section>}
      <p className="security-note">Both references must match. Blob URLs and raw CCTP proof bytes are never exposed.</p>
    </section>
  );
}
