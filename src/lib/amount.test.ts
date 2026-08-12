import { describe, expect, it } from "vitest";
import { normalizeUsdcAmount, parseUsdcAmount } from "./amount";

describe("USDC amount handling", () => {
  it("parses exact six-decimal base units", () => expect(parseUsdcAmount("12.345678")).toBe(12_345_678n));
  it("normalizes without floating point", () => expect(normalizeUsdcAmount("1.230000")).toBe("1.23"));
  it.each(["0", "-1", "1.0000001", "1e3", "NaN", ""])("rejects %s", (value) => expect(() => parseUsdcAmount(value)).toThrow());
});
