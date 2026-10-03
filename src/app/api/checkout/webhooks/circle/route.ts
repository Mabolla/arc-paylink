import { commerce, failure, json } from "@/lib/commerce/http";
import { circleCheckoutProvider, circleRequest } from "@/lib/commerce/circle";
import { CheckoutPayments } from "@/lib/commerce/payments";
import {
  verifyCircleSignature,
  applyCircleNotification,
} from "@/lib/commerce/webhook";
import { CommerceError } from "@/lib/commerce/store";
import { uuid } from "@/lib/commerce/service";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const keyId = uuid.safeParse(request.headers.get("x-circle-key-id"));
    const signature = request.headers.get("x-circle-signature");
    if (!keyId.success || !signature)
      throw new CommerceError("Missing Circle signature.", 401);
    if (Number(request.headers.get("content-length") ?? 0) > 65536)
      throw new CommerceError("Notification too large.", 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 65536)
      throw new CommerceError("Notification too large.", 413);
    const key = await circleRequest<{
      id: string;
      publicKey: string;
      algorithm: string;
    }>(`/v2/notifications/publicKey/${keyId.data}`);
    if (key.id !== keyId.data || !verifyCircleSignature(raw, signature, key))
      throw new CommerceError("Invalid Circle signature.", 401);
    return json(
      await applyCircleNotification(
        JSON.parse(raw),
        new CheckoutPayments(commerce(), circleCheckoutProvider()),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
