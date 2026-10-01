import { randomUUID } from "node:crypto";
import { createPublicClient, getAddress, http, isAddress, isHash, verifyMessage, type Address, type Hash } from "viem";
import { z } from "zod";
import { ARC_CHAIN_ID, arcChain } from "../arc";
import { CommerceError } from "./store";
import { orderPath, uuid } from "./service";
import { CheckoutPayments } from "./payments";
import { publicOrder, type Order } from "./types";
import { externalPaymentMessage, externalTransaction } from "./external-payment";

const address = z.string().refine((s) => isAddress(s, { strict: false })).transform((s) => getAddress(s));
export const ExternalReservation = z.object({
  payer: address,
  idempotencyKey: uuid,
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.iso.datetime(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();
type ExternalNetwork = {
  nonce(payer: Address): Promise<number>;
  transaction(hash: Hash): Promise<{ from: Address; to: Address | null; input: `0x${string}`; nonce: number; value: bigint }>;
};
export function externalNetwork(): ExternalNetwork {
  const client = createPublicClient({ chain: arcChain, transport: http(undefined, { timeout: 12000, retryCount: 1 }) });
  const check = async () => {
    if (await client.getChainId() !== ARC_CHAIN_ID) throw new CommerceError("RPC network mismatch.", 502);
  };
  return {
    async nonce(payer) { await check(); return client.getTransactionCount({ address: payer, blockTag: "pending" }); },
    async transaction(hash) { await check(); return client.getTransaction({ hash }); },
  };
}

export class ExternalCheckout {
  constructor(public payments: CheckoutPayments, public network: ExternalNetwork) {}

  async intent(id: string, inputPayer: unknown) {
    const payer = address.parse(inputPayer);
    const { value: order } = await this.payments.commerce.checkout(id);
    if (order.status === "paid") return { order: publicOrder(order), reserved: true };
    if (order.status === "cancelled") throw new CommerceError("This payment link has been cancelled.", 409);
    if (getAddress(order.recipient) === payer) throw new CommerceError("Use a different account from the receiving business.");
    if (order.attempt) {
      if (order.attempt.provider !== "external" || getAddress(order.attempt.walletAddress) !== payer)
        throw new CommerceError("Another payment is already reserved. Do not send another transfer.", 409);
      // After a reservation, recovery only: never offer another send instruction.
      return { order: publicOrder(order), reserved: true };
    }
    const intent = {
      payer,
      nonce: await this.network.nonce(payer),
      idempotencyKey: randomUUID(),
      expiresAt: new Date(Date.parse(this.payments.commerce.now()) + 10 * 60_000).toISOString(),
    };
    return { order: publicOrder(order), reserved: false, intent, message: externalPaymentMessage(order, intent) };
  }

  async reserve(id: string, input: unknown) {
    const data = ExternalReservation.parse(input);
    const service = this.payments.commerce;
    const saved = await service.checkout(id);
    const order = saved.value;
    if (order.status === "paid") return { order: publicOrder(order), alreadyReserved: true };
    if (order.status === "cancelled") throw new CommerceError("This payment link has been cancelled.", 409);
    if (getAddress(order.recipient) === data.payer) throw new CommerceError("Use a different account from the receiving business.");
    if (!await verifyMessage({ address: data.payer, message: externalPaymentMessage(order, data), signature: data.signature as `0x${string}` }))
      throw new CommerceError("The wallet signature does not match this order and payment attempt.", 401);
    if (order.attempt) {
      if (order.attempt.provider !== "external" || getAddress(order.attempt.walletAddress) !== data.payer || order.attempt.idempotencyKey !== data.idempotencyKey || order.attempt.externalNonce !== data.nonce)
        throw new CommerceError("Another payment is already reserved. Check its receipt instead of paying again.", 409);
      return { order: publicOrder(order), alreadyReserved: true };
    }
    const remaining = Date.parse(data.expiresAt) - Date.parse(service.now());
    if (remaining <= 0 || remaining > 10 * 60_000) throw new CommerceError("Payment reservation expired. Review a fresh request.", 409);
    if (await this.network.nonce(data.payer) !== data.nonce) throw new CommerceError("Your wallet nonce changed. Review a fresh request.", 409);
    const updated: Order = { ...order, status: "processing", attempt: {
      provider: "external", walletId: `external:${data.payer.toLowerCase()}`, walletAddress: data.payer,
      idempotencyKey: data.idempotencyKey, startedAt: service.now(), externalNonce: data.nonce,
    } };
    await service.store.write(orderPath(order.merchantId, id), updated, saved.version);
    return { order: publicOrder(updated), alreadyReserved: false, transaction: externalTransaction(updated, data.nonce) };
  }

  async confirm(id: string, hash: Hash) {
    if (!isHash(hash)) throw new CommerceError("Invalid transaction hash.");
    const { value: order } = await this.payments.commerce.checkout(id);
    if (order.attempt?.provider !== "external" || order.attempt.externalNonce === undefined)
      throw new CommerceError("This order has no external-wallet reservation.", 409);
    if (order.status !== "paid") {
      const expected = externalTransaction(order, order.attempt.externalNonce);
      const tx = await this.network.transaction(hash);
      if (getAddress(tx.from) !== getAddress(order.attempt.walletAddress) || tx.nonce !== expected.nonce || tx.to?.toLowerCase() !== expected.to.toLowerCase() || tx.input.toLowerCase() !== expected.data.toLowerCase() || tx.value !== 0n)
        throw new CommerceError("Transaction does not match the reserved wallet, nonce and exact transfer.", 409);
    }
    return this.payments.confirm(id, hash);
  }
}
