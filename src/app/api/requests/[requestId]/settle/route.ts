import { get, list } from "@vercel/blob";
import { createPublicClient, http, isHash } from "viem";
import { NextResponse } from "next/server";
import { arcTestnet } from "@/lib/arc";
import { requestView } from "@/lib/request-lifecycle";
import { appendRequestEvent, loadRequestRecord } from "@/lib/server-request-store";
import { vercelRequestStore } from "@/lib/vercel-request-store";
import { verifyPaymentReceipt } from "@/lib/verify-payment";
import { findSettlementRecord } from "@/lib/server-settlement-store";
import { validateSettlementCorrelationRecord } from "@/lib/validate-settlement-record";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const { requestId } = await context.params;
    const input = await request.json() as { transactionHash?: unknown; correlationId?: unknown };
    if (typeof input.transactionHash !== "string" || !isHash(input.transactionHash)) throw new Error("Invalid settlement transaction hash.");
    const store = vercelRequestStore(blobToken);
    const result = await loadRequestRecord(requestId, store);
    if (!result) return NextResponse.json({ state: "not-found" }, { status: 404 });
    const current = requestView(result.record, result.events);
    if (current.status === "settled") return NextResponse.json({ view: current });
    if (typeof input.correlationId === "string") {
      if (!result.record.request.obligation) throw new Error("Bridge settlement requires an obligation.");
      const shared = await findSettlementRecord(input.correlationId, result.record.request.obligation, {
        async list(prefix) { const found = await list({ prefix, limit: 2, token: blobToken }); return found.blobs.map((blob) => blob.pathname); },
        async read(pathname) { const found = await get(pathname, { access: "private", useCache: false, token: blobToken }); return found?.statusCode === 200 ? JSON.parse(await new Response(found.stream).text()) : undefined; },
      });
      if (shared === "not-found" || shared === "conflict") throw new Error("Verified bridge settlement record was not found.");
      const correlation = validateSettlementCorrelationRecord(shared);
      if (!['settled', 'fee-adjusted'].includes(correlation.settlement.state) || correlation.destination.mintTransactionHash.toLowerCase() !== input.transactionHash.toLowerCase()) throw new Error("Bridge settlement does not match this request.");
    } else {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const verified = await verifyPaymentReceipt(client, input.transactionHash, { recipient: result.record.request.recipient, amount: result.record.request.amount });
      if (current.status !== "pending") {
        const terminalAt = result.events.find((event) => event.type === "revoked" || event.type === "replaced")?.createdAt;
        const block = await client.getBlock({ blockNumber: verified.blockNumber });
        if (!terminalAt || Number(block.timestamp) * 1000 >= Date.parse(terminalAt)) throw new Error("A revoked or replaced request cannot accept a later settlement.");
      }
    }
    await appendRequestEvent(requestId, { type: "settled", createdAt: new Date().toISOString(), transactionHash: input.transactionHash }, `settled-${input.transactionHash.slice(2)}`, store);
    const updated = await loadRequestRecord(requestId, store);
    return NextResponse.json({ view: requestView(updated!.record, updated!.events) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settlement verification failed." }, { status: 409 });
  }
}
