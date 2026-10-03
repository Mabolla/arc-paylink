import { randomUUID } from "node:crypto";
import type { Address, Hash } from "viem";
import { getAddress } from "viem";
import { ARC_CHAIN_ID } from "../src/lib/arc";
import { parseUsdcAmount } from "../src/lib/amount";
import type { RequestView } from "../src/lib/request-lifecycle";
import type { VerificationResult } from "../src/lib/verify-payment";
import { AuditLedger, type AuditEvent, type AuditSession } from "./audit";
import { evaluateInvoice, type AgentPolicy, type InvoiceEvidence } from "./decision";

export type VerifiedPayment = VerificationResult & { blockTimestamp: bigint };
export type AgentDependencies = {
  ledger: AuditLedger;
  policy(): AgentPolicy;
  walletAddress: Address;
  load(requestId: string): Promise<RequestView>;
  approve(view: RequestView, invoice: InvoiceEvidence): Promise<boolean>;
  transfer(view: RequestView, idempotencyKey: string): Promise<{ transactionHash: Hash }>;
  verify(hash: Hash, view: RequestView): Promise<VerifiedPayment>;
  sync(requestId: string, hash: Hash): Promise<RequestView>;
  now?: () => Date;
};

const message = (error: unknown) => error instanceof Error ? error.message : "AgentOps operation failed.";
const sameId = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export class AgentWorkflow {
  constructor(private readonly deps: AgentDependencies) {}
  private now() { return this.deps.now?.() ?? new Date(); }

  private decision(session: AuditSession, view: RequestView, invoice: InvoiceEvidence) {
    const now = this.now();
    return evaluateInvoice({
      view, invoice, policy: this.deps.policy(), now,
      alreadyProcessed: session.hasAttempt(view.requestId, invoice.invoiceId, invoice.obligationId),
      spentTodayBaseUnits: session.reservedSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))),
    });
  }

  async evaluate(requestId: string, invoice: InvoiceEvidence) {
    return this.deps.ledger.exclusive(async (session) => {
      const view = await this.deps.load(requestId);
      if (!sameId(view.requestId, requestId)) throw new Error("PayLink response belongs to another request.");
      const decision = this.decision(session, view, invoice);
      await session.append({
        event: "decision", at: this.now().toISOString(), requestId, invoiceId: invoice.invoiceId,
        amount: view.request.amount, recipient: view.request.recipient,
        details: { outcome: decision.outcome, obligationId: invoice.obligationId, reasons: decision.reasons.join(" | ") },
      });
      return { decision, paymentPossible: decision.outcome === "payable" };
    });
  }

  async pay(requestId: string, invoice: InvoiceEvidence) {
    let transferAttempted = false;
    let transactionHash: Hash | undefined;
    let chainVerified = false;
    try {
      return await this.deps.ledger.exclusive(async (session) => {
        const view = await this.deps.load(requestId);
        if (!sameId(view.requestId, requestId)) throw new Error("PayLink response belongs to another request.");
        getAddress(this.deps.walletAddress);
        const base = { requestId: view.requestId, invoiceId: invoice.invoiceId, amount: view.request.amount, recipient: view.request.recipient };
        const decision = this.decision(session, view, invoice);
        await session.append({ event: "decision", at: this.now().toISOString(), ...base, details: { outcome: decision.outcome, obligationId: invoice.obligationId, reasons: decision.reasons.join(" | ") } });
        if (decision.outcome !== "payable") return { state: "blocked", paymentSent: false, decision };
        if (!await this.deps.approve(view, invoice)) return { state: "declined", paymentSent: false, decision };

        const latest = await this.deps.load(requestId);
        if (!sameId(latest.requestId, requestId)) throw new Error("PayLink response belongs to another request.");
        const checked = this.decision(session, latest, invoice);
        if (checked.outcome !== "payable" || parseUsdcAmount(latest.request.amount) !== parseUsdcAmount(view.request.amount)
          || latest.request.recipient.toLowerCase() !== view.request.recipient.toLowerCase()) {
          return { state: "blocked", paymentSent: false, decision: checked, error: "PayLink or policy changed while approval was pending." };
        }
        const idempotencyKey = randomUUID();
        const attempt = await session.append({
          event: "payment_started", at: this.now().toISOString(), ...base,
          details: { obligationId: invoice.obligationId, amountBaseUnits: parseUsdcAmount(view.request.amount).toString(), walletAddress: this.deps.walletAddress, chainId: ARC_CHAIN_ID, idempotencyKey },
        });
        // The durable reservation and cross-process lock must exist BEFORE invoking the wallet.
        transferAttempted = true;
        try {
          const submitted = await this.deps.transfer(latest, idempotencyKey);
          transactionHash = submitted.transactionHash;
          await session.append({ event: "payment_submitted", at: this.now().toISOString(), ...base, details: { transactionHash } });
          const verified = await this.deps.verify(transactionHash, latest);
          this.assertProof(session, attempt, transactionHash, verified);
          chainVerified = true;
          await session.append({
            event: "payment_verified", at: this.now().toISOString(), ...base,
            details: { transactionHash, amountBaseUnits: verified.amountBaseUnits.toString(), blockNumber: verified.blockNumber.toString(), blockTimestamp: verified.blockTimestamp.toString() },
          });
          return await this.synchronize(session, attempt, transactionHash);
        } catch (error) {
          // A wallet/RPC/audit error after submission cannot be reported as 'not sent'.
          try { await session.append({ event: "payment_failed", at: this.now().toISOString(), ...base, details: { transactionHash: transactionHash ?? null, chainVerified, reconciliationRequired: true } }); } catch { /* Preserve the known hash in the response even if storage is unavailable. */ }
          return { state: chainVerified ? "sync-required" : "reconciliation-required", paymentSent: chainVerified ? true : "unknown", chainVerified, transactionHash: transactionHash ?? null, error: message(error), instruction: "Do not pay again. Reconcile the recorded attempt." };
        }
      });
    } catch (error) {
      return { state: transferAttempted ? "reconciliation-required" : "blocked", paymentSent: transferAttempted ? "unknown" : false, chainVerified, transactionHash: transactionHash ?? null, error: message(error) };
    }
  }

  private assertProof(session: AuditSession, attempt: AuditEvent, hash: Hash, verified: VerifiedPayment) {
    if (verified.transactionHash.toLowerCase() !== hash.toLowerCase()
      || verified.sender.toLowerCase() !== String(attempt.details.walletAddress).toLowerCase()
      || verified.recipient.toLowerCase() !== attempt.recipient.toLowerCase()
      || verified.amountBaseUnits !== parseUsdcAmount(attempt.amount)) {
      throw new Error("Arc receipt does not match the reserved wallet, recipient, amount and transaction.");
    }
    if (verified.blockTimestamp < BigInt(Math.floor(Date.parse(attempt.at) / 1000))) throw new Error("Arc payment predates this payment attempt.");
    if (session.rows.some((row) => row.event === "payment_verified" && row.requestId !== attempt.requestId
      && String(row.details.transactionHash).toLowerCase() === hash.toLowerCase())) {
      throw new Error("This transaction is already assigned to another PayLink.");
    }
  }

  private async synchronize(session: AuditSession, attempt: AuditEvent, hash: Hash) {
    const base = { requestId: attempt.requestId, invoiceId: attempt.invoiceId, amount: attempt.amount, recipient: attempt.recipient };
    try {
      const view = await this.deps.sync(attempt.requestId, hash);
      if (!sameId(view.requestId, attempt.requestId) || view.status !== "settled" || view.transactionHash?.toLowerCase() !== hash.toLowerCase()) {
        throw new Error("PayLink did not record this transaction as the request settlement.");
      }
      await session.append({ event: "settlement_synced", at: this.now().toISOString(), ...base, details: { transactionHash: hash, paylinkStatus: "settled" } });
      return { state: "settled", paymentSent: true, chainVerified: true, paylinkStatus: "settled", transactionHash: hash };
    } catch (error) {
      try { await session.append({ event: "settlement_sync_failed", at: this.now().toISOString(), ...base, details: { transactionHash: hash, reconciliationRequired: true } }); } catch { /* Payment is confirmed even if audit append fails. */ }
      return { state: "sync-required", paymentSent: true, chainVerified: true, paylinkStatus: "sync-required", transactionHash: hash, error: message(error), instruction: "Payment is confirmed. Use reconcile_payment to retry only verification and status synchronization." };
    }
  }

  async reconcile(requestId: string) {
    // Deliberately has no call to transfer/approve: recovery cannot send funds.
    return this.deps.ledger.exclusive(async (session) => {
      const attempt = session.rows.find((row) => row.event === "payment_started" && sameId(row.requestId, requestId));
      if (!attempt) throw new Error("No recorded payment attempt exists for this PayLink.");
      if (attempt.details.chainId !== ARC_CHAIN_ID) throw new Error("Recorded attempt belongs to a different Arc network.");
      const saved = session.rows.find((row) => row.requestId === attempt.requestId && row.event === "payment_submitted");
      if (!saved || typeof saved.details.transactionHash !== "string") {
        return { state: "reconciliation-required", paymentSent: "unknown", error: "The wallet result contains no persisted transaction hash. Operator reconciliation with Circle is required; automatic resubmission is blocked." };
      }
      const hash = saved.details.transactionHash as Hash;
      const view = await this.deps.load(requestId);
      if (!sameId(view.requestId, requestId) || view.request.chainId !== ARC_CHAIN_ID
        || parseUsdcAmount(view.request.amount) !== parseUsdcAmount(attempt.amount)
        || view.request.recipient.toLowerCase() !== attempt.recipient.toLowerCase()
        || view.request.obligation?.id !== attempt.details.obligationId) throw new Error("Current PayLink facts conflict with the reserved payment.");
      const verified = await this.deps.verify(hash, view);
      this.assertProof(session, attempt, hash, verified);
      if (!session.rows.some((row) => row.requestId === attempt.requestId && row.event === "payment_verified")) {
        await session.append({
          event: "payment_verified", at: this.now().toISOString(), requestId: attempt.requestId, invoiceId: attempt.invoiceId,
          amount: attempt.amount, recipient: attempt.recipient,
          details: { transactionHash: hash, amountBaseUnits: verified.amountBaseUnits.toString(), blockNumber: verified.blockNumber.toString(), blockTimestamp: verified.blockTimestamp.toString() },
        });
      }
      return this.synchronize(session, attempt, hash);
    });
  }
}
