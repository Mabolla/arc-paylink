import { getAddress, isAddress } from "viem";
import { normalizeUsdcAmount } from "./amount";

export type PaymentRequest = {
  title: string;
  amount: string;
  recipient: `0x${string}`;
  route: "arc" | "bridge";
};

export function createPaymentRequest(input: {
  title: string;
  amount: string;
  recipient: string;
  route?: string;
}): PaymentRequest {
  const title = input.title.trim();
  if (!title || title.length > 80) throw new Error("Title must be between 1 and 80 characters.");
  if (!isAddress(input.recipient, { strict: false })) throw new Error("Enter a valid EVM recipient address.");

  return {
    title,
    amount: normalizeUsdcAmount(input.amount),
    recipient: getAddress(input.recipient),
    route: input.route === "bridge" ? "bridge" : "arc",
  };
}

export function requestToSearchParams(request: PaymentRequest): URLSearchParams {
  const params = new URLSearchParams({
    title: request.title,
    amount: request.amount,
    recipient: request.recipient,
  });
  if (request.route === "bridge") params.set("route", "bridge");
  return params;
}
