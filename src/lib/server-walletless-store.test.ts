import { describe, expect, it } from "vitest";
import { createWalletlessRecord } from "./walletless-record";
import { createWalletlessRecordEntry, loadWalletlessRecord } from "./server-walletless-store";

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      list: async (prefix: string) => [...values.keys()].filter((key) => key.startsWith(prefix)),
      read: async (path: string) => JSON.parse(values.get(path)!),
      put: async (path: string, body: string) => { if (values.has(path)) throw new Error("overwrite"); values.set(path, body); },
    },
  };
}

const record = createWalletlessRecord({
  managementToken: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-09-20T12:00:00.000Z",
  paymentId: `0x${"22".repeat(32)}`,
  factory: "0x2222222222222222222222222222222222222222",
  escrow: "0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B",
  sender: "0x1111111111111111111111111111111111111111",
  recipientEmail: "recipient@example.com",
  title: "Logo delivery",
  reference: "INV-14",
  amountBaseUnits: "10000",
  amountUsdc: "0.01",
  expiry: "2027-09-20T12:00:00.000Z",
  secretHash: `0x${"33".repeat(32)}`,
  creationHash: `0x${"44".repeat(32)}`,
  fundingHash: `0x${"55".repeat(32)}`,
});

describe("walletless server store", () => {
  it("creates an immutable private record", async () => {
    const { values, store } = memory();
    await createWalletlessRecordEntry(record, store);
    expect(values.size).toBe(1);
    await expect(createWalletlessRecordEntry(record, store)).rejects.toThrow("already registered");
    await expect(loadWalletlessRecord(record.paymentId, store)).resolves.toMatchObject({ escrow: record.escrow });
  });
});
