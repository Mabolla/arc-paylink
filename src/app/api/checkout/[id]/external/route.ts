import { z } from "zod";
import { readJsonObject } from "@/lib/api-request";
import { commerce, failure, json } from "@/lib/commerce/http";
import { circleCheckoutProvider } from "@/lib/commerce/circle";
import { CheckoutPayments } from "@/lib/commerce/payments";
import { ExternalCheckout, ExternalReservation, externalNetwork } from "@/lib/commerce/external";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
const checkout = () => new ExternalCheckout(new CheckoutPayments(commerce(), circleCheckoutProvider()), externalNetwork());
export async function GET(request: Request, context: Context) {
  try { return json(await checkout().intent((await context.params).id, new URL(request.url).searchParams.get("payer"))); }
  catch (e) { return failure(e); }
}
export async function POST(request: Request, context: Context) {
  try {
    const input = z.discriminatedUnion("action", [
      ExternalReservation.extend({ action: z.literal("reserve") }),
      z.object({ action: z.literal("confirm"), transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict(),
    ]).parse(await readJsonObject(request));
    const id = (await context.params).id;
    if (input.action === "confirm") return json({ order: await checkout().confirm(id, input.transactionHash as `0x${string}`) });
    return json(await checkout().reserve(id, { payer: input.payer, idempotencyKey: input.idempotencyKey, nonce: input.nonce, expiresAt: input.expiresAt, signature: input.signature }));
  } catch (e) { return failure(e); }
}
