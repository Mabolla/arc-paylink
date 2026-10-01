import { randomUUID } from "node:crypto";
import { getAddress, isHash, type Hash } from "viem";
import { CommerceError } from "./store";
import { CommerceService, orderPath, uuid } from "./service";
import { publicOrder, type Order } from "./types";

export type CustomerWallet = { id: string; address: `0x${string}` };
export type PaymentProof = {
  transactionHash: Hash;
  sender: `0x${string}`;
  blockNumber: string;
  timestamp: number;
};
export interface CheckoutProvider {
  wallet(userToken: string, walletId: string): Promise<CustomerWallet>;
  prepare(userToken: string, order: Order): Promise<string>;
  transaction(userToken: string, order: Order): Promise<Hash | undefined>;
  transactionIds?(userToken: string, challengeId: string): Promise<string[]>;
  verify(hash: Hash, order: Order): Promise<PaymentProof>;
}

export class CheckoutPayments {
  constructor(
    public commerce: CommerceService,
    public provider: CheckoutProvider,
  ) {}

  async prepare(id: string, userToken: string, walletId: string) {
    uuid.parse(walletId);
    const wallet = await this.provider.wallet(userToken, walletId);
    let saved = await this.commerce.checkout(id);
    if (saved.value.status === "paid")
      return { order: publicOrder(saved.value) };
    if (saved.value.status === "cancelled")
      throw new CommerceError("This payment link has been cancelled.", 409);
    if (saved.value.attempt?.provider === "external")
      throw new CommerceError("This order already has an external-wallet payment. Check its transaction instead of starting a Circle payment.", 409);
    if (getAddress(wallet.address) === getAddress(saved.value.recipient))
      throw new CommerceError(
        "Use the customer's account, not the receiving business account.",
      );
    const path = orderPath(saved.value.merchantId, id);
    if (!saved.value.attempt) {
      const updated: Order = {
        ...saved.value,
        status: "processing",
        attempt: {
          walletId,
          walletAddress: getAddress(wallet.address),
          idempotencyKey: randomUUID(),
          startedAt: this.commerce.now(),
        },
      };
      // Durable conditional reservation precedes any call that can create a transfer.
      await this.commerce.store.write(path, updated, saved.version);
      saved = await this.commerce.checkout(id);
    }
    if (
      saved.value.attempt!.walletId !== walletId ||
      getAddress(saved.value.attempt!.walletAddress) !==
        getAddress(wallet.address)
    )
      throw new CommerceError(
        "A payment is already in progress from another account. Contact the business before trying again.",
        409,
      );
    let challengeId = saved.value.attempt!.challengeId;
    if (!challengeId) {
      if (
        Date.parse(this.commerce.now()) -
          Date.parse(saved.value.attempt!.startedAt) >
        23 * 3600_000
      )
        throw new CommerceError(
          "This payment needs reconciliation before another approval can be prepared.",
          409,
        );
      challengeId = uuid.parse(
        await this.provider.prepare(userToken, saved.value),
      );
      // Concurrent retries get the same provider idempotency key and challenge.
      const fresh = await this.commerce.checkout(id);
      if (fresh.value.status === "paid")
        return { order: publicOrder(fresh.value) };
      if (!fresh.value.attempt?.challengeId)
        await this.commerce.store.write(
          path,
          { ...fresh.value, attempt: { ...fresh.value.attempt, challengeId } },
          fresh.version,
        );
    }
    if (this.provider.transactionIds) {
      for (const transactionId of await this.provider.transactionIds(
        userToken,
        challengeId,
      )) {
        const pointer = `circle-transactions/${uuid.parse(transactionId)}.json`;
        const existing = await this.commerce.store.read<{ orderId: string }>(
          pointer,
        );
        if (existing && existing.value.orderId !== id)
          throw new CommerceError(
            "Circle transaction is already linked to another order.",
            409,
          );
        if (!existing) {
          try {
            await this.commerce.store.write(pointer, { orderId: id });
          } catch (e) {
            if (
              (await this.commerce.store.read<{ orderId: string }>(pointer))
                ?.value.orderId !== id
            )
              throw e;
          }
        }
      }
    }
    return {
      order: publicOrder((await this.commerce.checkout(id)).value),
      challengeId,
    };
  }

  async reconcile(id: string, userToken: string, walletId: string) {
    const wallet = await this.provider.wallet(userToken, uuid.parse(walletId));
    const { value: order } = await this.commerce.checkout(id);
    if (order.status === "paid") {
      await this.publishReceipt(order);
      return publicOrder(order);
    }
    if (
      !order.attempt ||
      order.attempt.walletId !== wallet.id ||
      order.attempt.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
    )
      throw new CommerceError(
        "No payment from this account is recorded for this order.",
        409,
      );
    if (!order.attempt.challengeId)
      throw new CommerceError(
        "Resume payment preparation with the same account to recover the saved attempt.",
        409,
      );
    const hash = await this.provider.transaction(userToken, order);
    if (!hash) return publicOrder(order);
    return this.confirm(id, hash);
  }

  async confirm(id: string, hash: Hash) {
    if (!isHash(hash)) throw new CommerceError("Invalid transaction hash.");
    const saved = await this.commerce.checkout(id);
    const order = saved.value;
    if (order.status === "paid") {
      if (order.receipt?.transactionHash.toLowerCase() !== hash.toLowerCase())
        throw new CommerceError("Order already has a different receipt.", 409);
      await this.publishReceipt(order);
      return publicOrder(order);
    }
    if (order.status !== "processing" || !order.attempt)
      throw new CommerceError("There is no reserved payment to confirm.", 409);
    const proof = await this.provider.verify(hash, order);
    if (
      proof.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      proof.sender.toLowerCase() !==
        order.attempt.walletAddress.toLowerCase() ||
      proof.timestamp * 1000 <
        Math.floor(Date.parse(order.attempt.startedAt) / 1000) * 1000
    )
      throw new CommerceError(
        "Receipt does not match this customer's payment attempt.",
        409,
      );
    // A single onchain transfer can settle one order only, across all workspaces.
    const claimPath = `transfers/${hash.toLowerCase()}.json`;
    const claim = await this.commerce.store.read<{ orderId: string }>(
      claimPath,
    );
    if (claim && claim.value.orderId !== id)
      throw new CommerceError(
        "Transfer already belongs to another order.",
        409,
      );
    if (!claim) {
      try {
        await this.commerce.store.write(claimPath, { orderId: id });
      } catch (e) {
        if (
          (await this.commerce.store.read<{ orderId: string }>(claimPath))
            ?.value.orderId !== id
        )
          throw e;
      }
    }
    const settled: Order = {
      ...order,
      status: "paid",
      receipt: {
        transactionHash: hash,
        sender: proof.sender,
        blockNumber: proof.blockNumber,
        confirmedAt: this.commerce.now(),
      },
    };
    try {
      await this.commerce.store.write(
        orderPath(order.merchantId, id),
        settled,
        saved.version,
      );
    } catch (e) {
      const current = await this.commerce.checkout(id);
      if (
        current.value.status !== "paid" ||
        current.value.receipt?.transactionHash.toLowerCase() !==
          hash.toLowerCase()
      )
        throw e;
    }
    const current = (await this.commerce.checkout(id)).value;
    await this.publishReceipt(current);
    return publicOrder(current);
  }

  private async publishReceipt(order: Order) {
    if (!order.receipt) return;
    const eventId = `${order.id}:${order.receipt.transactionHash.toLowerCase()}`;
    const path = `merchants/${order.merchantId}/receipts/${order.receipt.confirmedAt}-${order.id}.json`;
    if (!(await this.commerce.store.read(path))) {
      try {
        await this.commerce.store.write(path, {
          eventId,
          type: "payment.confirmed",
          order: publicOrder(order),
        });
      } catch (e) {
        if (!(await this.commerce.store.read(path))) throw e;
      }
    }
  }
}
