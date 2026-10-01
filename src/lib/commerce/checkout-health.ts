import { z } from "zod";
import { circleRequest } from "./circle";
import { CommerceError } from "./store";

const subscriptions = z.array(
  z.object({
    endpoint: z.url(),
    enabled: z.boolean(),
    notificationTypes: z.array(z.string()),
  }),
);

export async function checkoutHealth(request: Request) {
  const embeddedWalletReady = !!(
    process.env.CIRCLE_API_KEY?.trim() &&
    process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim() &&
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim()
  );
  if (!process.env.CIRCLE_API_KEY?.trim())
    return {
      embeddedWalletReady: false,
      notificationSubscriptionReady: false,
      checkedAt: new Date().toISOString(),
    };

  // Keep account metadata on the server; only the matching deployment's
  // active outbound subscription contributes to this readiness signal.
  const result = subscriptions.safeParse(
    await circleRequest<unknown>("/v2/notifications/subscriptions"),
  );
  if (!result.success)
    throw new CommerceError("Circle returned invalid subscription metadata.", 502);
  const endpoint = new URL(
    "/api/checkout/webhooks/circle",
    new URL(request.url).origin,
  ).href;
  return {
    embeddedWalletReady,
    notificationSubscriptionReady: result.data.some(
      (subscription) =>
        subscription.endpoint === endpoint &&
        subscription.enabled &&
        subscription.notificationTypes.some((type) =>
          ["transactions.outbound", "transactions.*", "*"].includes(type),
        ),
    ),
    checkedAt: new Date().toISOString(),
  };
}
