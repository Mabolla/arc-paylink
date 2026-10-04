import { createPublicKey, createVerify } from "node:crypto";
import { z } from "zod";
import { isHash } from "viem";
import { IS_ARC_MAINNET } from "../arc";
import { CommerceError } from "./store";
import { uuid } from "./service";
import type { CheckoutPayments } from "./payments";

export function verifyCircleSignature(
  raw: string,
  signature: string,
  key: { algorithm: string; publicKey: string },
) {
  if (key.algorithm !== "ECDSA_SHA_256" || signature.length > 1024)
    return false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(key.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ec") return false;
    return createVerify("SHA256")
      .update(raw)
      .verify(publicKey, signature, "base64");
  } catch {
    return false;
  }
}
const Notification = z
  .object({
    notificationId: uuid,
    notificationType: z.string(),
    notification: z
      .object({
        id: uuid,
        walletId: uuid,
        blockchain: z.string(),
        state: z.string(),
        txHash: z.string().optional(),
        refId: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export async function applyCircleNotification(
  input: unknown,
  payments: CheckoutPayments,
) {
  const raw = input as { notificationType?: unknown };
  if (raw?.notificationType !== "transactions.outbound")
    return { ignored: true };
  const event = Notification.parse(input);
  const tx = event.notification;
  const network =
    process.env.CIRCLE_ARC_BLOCKCHAIN ||
    (IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET");
  if (
    tx.blockchain !== network ||
    !["CONFIRMED", "COMPLETE"].includes(tx.state) ||
    !tx.txHash ||
    !isHash(tx.txHash)
  )
    return { ignored: true };
  const pointer = await payments.commerce.store.read<{ orderId: string }>(
    `circle-transactions/${tx.id}.json`,
  );
  const orderId =
    pointer?.value.orderId ??
    (tx.refId?.startsWith("apc:") ? uuid.parse(tx.refId.slice(4)) : undefined);
  if (!orderId) return { ignored: true };
  const order = (await payments.commerce.checkout(orderId)).value;
  if (!order.attempt || order.attempt.walletId !== tx.walletId)
    throw new CommerceError(
      "Notification does not match the reserved payment.",
      409,
    );
  // A valid Circle signature is only a trigger. Arc receipt verification remains mandatory.
  await payments.confirm(orderId, tx.txHash, "circle-webhook");
  return { accepted: true };
}
