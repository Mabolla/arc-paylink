import { getAddress, isAddress } from "viem";
import { normalizeUsdcAmount } from "./amount";

export type PaymentRequest = {
  title: string;
  amount: string;
  recipient: `0x${string}`;
};

export function createPaymentRequest(input: {
  title: string;
  amount: string;
  recipient: string;
}): PaymentRequest {
  const title = input.title.trim();
  if (!title || title.length > 80) throw new Error("Title must be between 1 and 80 characters.");
  if (!isAddress(input.recipient, { strict: false })) throw new Error("Enter a valid EVM recipient address.");

  return {
    title,
    amount: normalizeUsdcAmount(input.amount),
    recipient: getAddress(input.recipient),
  };
}

export function requestToSearchParams(request: PaymentRequest): URLSearchParams {
  return new URLSearchParams({
    title: request.title,
    amount: request.amount,
    recipient: request.recipient,
  });
}
