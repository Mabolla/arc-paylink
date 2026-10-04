import { CommerceError } from "./store";

/** Temporary, single-order fault injection on the isolated pilot only.
 * Return a retryable error, never acknowledge or manufacture a payment.
 * An absolute expiry restores normal delivery without a browser or operator.
 */
export function assertAcceptanceDeliveryReady(
  orderId: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
) {
  if (env.VERCEL_PROJECT_PRODUCTION_URL !== "arc-paylink-collections-pilot.vercel.app" ||
      env.ARCPAYLINK_ACCEPTANCE_HOLD_ORDER_ID !== orderId) return;
  const until = Date.parse(env.ARCPAYLINK_ACCEPTANCE_HOLD_UNTIL ?? "");
  if (!Number.isFinite(until) || until - now > 600_000)
    throw new CommerceError("Pilot acceptance delivery hold is misconfigured.", 503);
  if (now < until)
    throw new CommerceError("Pilot acceptance delivery is temporarily deferred. Retry this notification.", 503);
}
