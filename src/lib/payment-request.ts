import { getAddress, isAddress } from "viem";
import { normalizeUsdcAmount } from "./amount";
import { createObligation, type PaymentObligation } from "./obligation";

export type PaymentRequest = {
  title: string;
  amount: string;
  recipient: `0x${string}`;
  route: "arc" | "bridge";
  obligation?: PaymentObligation;
};

export function createPaymentRequest(input: {
  title: string;
  amount: string;
  recipient: string;
  route?: string;
  obligationKind?: string;
  obligationId?: string;
}): PaymentRequest {
  const title = input.title.trim();
  if (!title || title.length > 80) throw new Error("Title must be between 1 and 80 characters.");
  if (!isAddress(input.recipient, { strict: false })) throw new Error("Enter a valid EVM recipient address.");

  return {
    title,
    amount: normalizeUsdcAmount(input.amount),
    recipient: getAddress(input.recipient),
    route: input.route === "bridge" ? "bridge" : "arc",
    obligation: createObligation({ kind: input.obligationKind, id: input.obligationId }),
  };
}

export function requestToSearchParams(request: PaymentRequest): URLSearchParams {
  const params = new URLSearchParams({
    title: request.title,
    amount: request.amount,
    recipient: request.recipient,
  });
  if (request.route === "bridge") params.set("route", "bridge");
  if (request.obligation) {
    params.set("obligationKind", request.obligation.kind);
    params.set("obligationId", request.obligation.id);
  }
  return params;
}
