import { getAddress, isAddress } from "viem";
import { ARC_CHAIN_ID } from "../src/lib/arc";
import { parseUsdcAmount } from "../src/lib/amount";
import type { RequestView } from "../src/lib/request-lifecycle";

export type InvoiceEvidence = {
  invoiceId: string;
  obligationId: string;
  recipient: string;
  amount: string;
  dueDate: string;
};

export type AgentPolicy = {
  allowedRecipients: Set<string>;
  maxPaymentBaseUnits: bigint;
  dailyLimitBaseUnits: bigint;
};

export type Decision = {
  outcome: "payable" | "wait" | "review" | "reject";
  reasons: string[];
  invoiceId: string;
  requestId: string;
  amount: string;
  recipient: string;
};

export function createAgentPolicy(input: {
  allowedRecipients: string;
  maxPaymentUsdc: string;
  dailyLimitUsdc: string;
}): AgentPolicy {
  const allowedRecipients = input.allowedRecipients
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => {
      if (!isAddress(address)) throw new Error("Agent policy contains an invalid recipient address.");
      return getAddress(address).toLowerCase();
    });
  if (!allowedRecipients.length) throw new Error("At least one payee must be explicitly allowlisted.");
  const maxPaymentBaseUnits = parseUsdcAmount(input.maxPaymentUsdc);
  const dailyLimitBaseUnits = parseUsdcAmount(input.dailyLimitUsdc);
  if (dailyLimitBaseUnits < maxPaymentBaseUnits) throw new Error("Daily budget must be at least the per-payment limit.");
  return { allowedRecipients: new Set(allowedRecipients), maxPaymentBaseUnits, dailyLimitBaseUnits };
}

export function evaluateInvoice(input: {
  view: RequestView;
  invoice: InvoiceEvidence;
  policy: AgentPolicy;
  now?: Date;
  alreadyProcessed?: boolean;
  spentTodayBaseUnits?: bigint;
}): Decision {
  const { view, invoice, policy } = input;
  const reasons: string[] = [];
  let outcome: Decision["outcome"] = "payable";
  const reject = (reason: string) => { reasons.push(reason); outcome = "reject"; };
  const review = (reason: string) => { if (outcome !== "reject") outcome = "review"; reasons.push(reason); };
  const request = view.request;

  if (view.status !== "pending") reject(`PayLink is ${view.status}; only pending requests can be paid.`);
  if (request.route !== "arc") reject("Only direct Arc PayLinks are supported by this payment agent.");
  if (request.chainId !== ARC_CHAIN_ID) reject(`PayLink network does not match this AgentOps instance (expected Arc chain ${ARC_CHAIN_ID}).`);
  if (request.obligation?.kind !== "invoice") reject("PayLink must reference an invoice obligation.");
  if (!request.obligation || request.obligation.id !== invoice.obligationId) reject("Invoice obligation ID does not match the PayLink.");
  if (!invoice.invoiceId.trim() || invoice.invoiceId.length > 120) reject("Invoice ID is missing or too long.");

  let invoiceRecipient: string;
  try {
    if (!isAddress(invoice.recipient)) throw new Error();
    invoiceRecipient = getAddress(invoice.recipient);
  } catch {
    invoiceRecipient = "";
    reject("Invoice payee address is invalid.");
  }
  if (invoiceRecipient && invoiceRecipient.toLowerCase() !== request.recipient.toLowerCase()) {
    review("Invoice payee differs from the PayLink recipient.");
  }
  if (invoiceRecipient && !policy.allowedRecipients.has(invoiceRecipient.toLowerCase())) {
    review("Payee is not on the business allowlist; a human must vet it before payment.");
  }

  let invoiceAmount = 0n;
  try { invoiceAmount = parseUsdcAmount(invoice.amount); }
  catch { reject("Invoice amount is not a valid USDC amount."); }
  if (invoiceAmount > 0n) {
    let requestAmount = 0n;
    try { requestAmount = parseUsdcAmount(request.amount); }
    catch { reject("PayLink amount is invalid."); }
    if (requestAmount !== invoiceAmount) review("Invoice amount differs from the exact PayLink amount.");
    if (invoiceAmount > policy.maxPaymentBaseUnits) review("Payment exceeds the configured per-payment limit.");
    if ((input.spentTodayBaseUnits ?? 0n) + invoiceAmount > policy.dailyLimitBaseUnits) review("Payment exceeds the remaining daily budget.");
  }

  const dueAt = Date.parse(invoice.dueDate);
  if (!Number.isFinite(dueAt)) review("Invoice due date is missing or invalid.");
  else if (dueAt > (input.now ?? new Date()).getTime()) {
    if (outcome === "payable") outcome = "wait";
    reasons.push(`Invoice is not due until ${new Date(dueAt).toISOString()}.`);
  }
  if (input.alreadyProcessed) reject("This PayLink, invoice or obligation already has a recorded payment attempt; reconcile before retrying.");
  if (outcome === "payable") reasons.push("Invoice ID, obligation, recipient, amount, due date, Arc route, duplicate history, and policy checks pass.");

  return {
    outcome,
    reasons,
    invoiceId: invoice.invoiceId.trim(),
    requestId: view.requestId,
    amount: request.amount,
    recipient: request.recipient,
  };
}
