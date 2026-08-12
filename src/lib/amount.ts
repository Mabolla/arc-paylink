import { formatUnits, parseUnits } from "viem";
import { USDC_DECIMALS } from "./arc";

export function parseUsdcAmount(value: string): bigint {
  const amount = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) {
    throw new Error("Enter a positive USDC amount with no more than 6 decimals.");
  }

  const units = parseUnits(amount, USDC_DECIMALS);
  if (units <= 0n) throw new Error("Amount must be greater than zero.");
  return units;
}

export function normalizeUsdcAmount(value: string): string {
  return formatUnits(parseUsdcAmount(value), USDC_DECIMALS);
}
