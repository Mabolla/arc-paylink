import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { CommerceService } from "./service";
import { MemoryStore } from "./test-store";
import { CheckoutPayments, type CheckoutProvider } from "./payments";
import { ExternalCheckout } from "./external";
import { externalPaymentMessage, externalTransaction } from "./external-payment";
const payer = privateKeyToAccount(`0x${"1".repeat(64)}`);
const wrongPayer = privateKeyToAccount(`0x${"2".repeat(64)}`);
const hash = `0x${"a".repeat(64)}` as const;
const now = "2026-10-01T12:00:00.000Z";
async function setup() {
  const service = new CommerceService(new MemoryStore(), () => now);
  const owner = await service.createWorkspace({ name: "Internal acceptance", recipient: "0x3333333333333333333333333333333333333333" });
  const principal = await service.authorize(owner.token);
  const order = await service.createOrder(principal, { reference: "SELF-TEST", title: "Internal test", amount: "0.01", idempotencyKey: randomUUID() });
  const provider: CheckoutProvider = {
    wallet: vi.fn(async () => ({ id: randomUUID(), address: payer.address })),
    prepare: vi.fn(async () => randomUUID()), transaction: vi.fn(async () => hash),
    verify: vi.fn(async () => ({ transactionHash: hash, sender: payer.address, blockNumber: "99", timestamp: Date.parse(now) / 1000 + 1 })),
  };
  const payments = new CheckoutPayments(service, provider);
  const transaction = externalTransaction(order, 8);
  const network = {
    nonce: vi.fn(async () => 8),
    transaction: vi.fn(async () => ({ from: payer.address, to: transaction.to as Address, input: transaction.data, nonce: 8, value: 0n })),
  };
  const external = new ExternalCheckout(payments, network);
  const offered = await external.intent(order.id, payer.address);
  const intent = offered.intent!;
  const signed = { ...intent, signature: await payer.signMessage({ message: externalPaymentMessage(order, intent) }) };
  return { service, principal, order, provider, payments, network, external, intent, signed };
}
describe("existing-wallet checkout", () => {
  it("verifies wallet ownership, records real proof and publishes the same merchant event", async () => {
    const s = await setup();
    expect(await s.external.reserve(s.order.id, s.signed)).toMatchObject({ alreadyReserved: false, transaction: { nonce: 8, value: "0" } });
    expect(await s.external.confirm(s.order.id, hash)).toMatchObject({ status: "paid", receipt: { transactionHash: hash } });
    expect(await s.service.summary(s.principal)).toMatchObject({ paidUsdc: "0.01", outstandingUsdc: "0" });
    expect((await s.service.events(s.principal)).events).toHaveLength(1);
    expect(s.provider.prepare).not.toHaveBeenCalled();
  });
  it("rejects a signature from another wallet and signed terms changed after review", async () => {
    const s = await setup();
    const signature = await wrongPayer.signMessage({ message: externalPaymentMessage(s.order, s.intent) });
    await expect(s.external.reserve(s.order.id, { ...s.signed, signature })).rejects.toMatchObject({ status: 401 });
    await expect(s.external.reserve(s.order.id, { ...s.signed, nonce: 9 })).rejects.toMatchObject({ status: 401 });
    await expect(s.external.reserve(s.order.id, { ...s.signed, signature: `0x${"11".repeat(65)}` })).rejects.toMatchObject({ status: 401 });
    expect((await s.service.checkout(s.order.id)).value.status).toBe("pending");
  });
  it("rejects an expired reservation and a changed chain nonce before reserving", async () => {
    const s = await setup();
    s.network.nonce.mockResolvedValueOnce(9);
    await expect(s.external.reserve(s.order.id, s.signed)).rejects.toThrow("nonce changed");
    s.service.now = () => "2026-10-01T12:11:00.000Z";
    await expect(s.external.reserve(s.order.id, s.signed)).rejects.toThrow("expired");
  });
  it("does not offer another transfer on reservation retry or page reload", async () => {
    const s = await setup();
    await s.external.reserve(s.order.id, s.signed);
    expect(await s.external.reserve(s.order.id, s.signed)).not.toHaveProperty("transaction");
    expect(await s.external.intent(s.order.id, payer.address)).toMatchObject({ reserved: true });
    expect(await s.external.intent(s.order.id, payer.address)).not.toHaveProperty("intent");
    await expect(s.external.intent(s.order.id, wrongPayer.address)).rejects.toMatchObject({ status: 409 });
    await expect(s.payments.prepare(s.order.id, "session", randomUUID())).rejects.toThrow("external-wallet");
  });
  it("rejects a transfer with the wrong nonce or calldata even when a transfer log could match", async () => {
    const s = await setup();
    await s.external.reserve(s.order.id, s.signed);
    s.network.transaction.mockResolvedValueOnce({ from: payer.address, to: s.order.recipient, input: "0x", nonce: 7, value: 0n });
    await expect(s.external.confirm(s.order.id, hash)).rejects.toMatchObject({ status: 409 });
    expect(s.provider.verify).not.toHaveBeenCalled();
    expect((await s.service.checkout(s.order.id)).value.status).toBe("processing");
  });
  it("makes receipt retries idempotent and rejects a different second receipt", async () => {
    const s = await setup();
    await s.external.reserve(s.order.id, s.signed);
    await s.external.confirm(s.order.id, hash);
    await s.external.confirm(s.order.id, hash);
    expect((await s.service.events(s.principal)).events).toHaveLength(1);
    await expect(s.external.confirm(s.order.id, `0x${"b".repeat(64)}`)).rejects.toThrow("different receipt");
  });
});
