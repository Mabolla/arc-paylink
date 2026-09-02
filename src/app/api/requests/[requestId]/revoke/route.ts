import { keccak256, stringToHex } from "viem";
import { NextResponse } from "next/server";
import { assertPending, authorizeRequest, requestView } from "@/lib/request-lifecycle";
import { appendRequestEvent, loadRequestRecord } from "@/lib/server-request-store";
import { vercelRequestStore } from "@/lib/vercel-request-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const { requestId } = await context.params;
    const input = await request.json() as { managementToken?: unknown };
    const token = String(input.managementToken ?? "");
    const store = vercelRequestStore(blobToken);
    const result = await loadRequestRecord(requestId, store);
    if (!result) return NextResponse.json({ state: "not-found" }, { status: 404 });
    authorizeRequest(result.record, token);
    const current = requestView(result.record, result.events);
    if (current.status === "revoked") return NextResponse.json({ view: current });
    assertPending(current);
    await appendRequestEvent(requestId, { type: "revoked", createdAt: new Date().toISOString() }, `revoke-${keccak256(stringToHex(token)).slice(2, 18)}`, store);
    const updated = await loadRequestRecord(requestId, store);
    return NextResponse.json({ view: requestView(updated!.record, updated!.events) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not revoke the request.";
    return NextResponse.json({ error: message }, { status: /settled|pending/i.test(message) ? 409 : 404 });
  }
}
