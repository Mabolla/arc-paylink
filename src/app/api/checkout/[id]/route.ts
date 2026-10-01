import { z } from "zod";
import { readJsonObject } from "@/lib/api-request";
import { commerce, json, failure } from "@/lib/commerce/http";
import { publicOrder } from "@/lib/commerce/types";
import { CheckoutPayments } from "@/lib/commerce/payments";
import { circleCheckoutProvider } from "@/lib/commerce/circle";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Context) {
  try {
    return json({
      order: publicOrder((await commerce().checkout((await params).id)).value),
      embeddedWalletReady: !!(
        process.env.CIRCLE_API_KEY &&
        process.env.NEXT_PUBLIC_CIRCLE_APP_ID &&
        process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const input = z
      .object({
        action: z.enum(["prepare", "reconcile"]),
        userToken: z.string().min(1).max(8192),
        walletId: z.string().uuid(),
      })
      .strict()
      .parse(await readJsonObject(request));
    const payments = new CheckoutPayments(commerce(), circleCheckoutProvider());
    const id = (await params).id;
    if (input.action === "prepare")
      return json(await payments.prepare(id, input.userToken, input.walletId));
    return json({
      order: await payments.reconcile(id, input.userToken, input.walletId),
    });
  } catch (e) {
    return failure(e);
  }
}
