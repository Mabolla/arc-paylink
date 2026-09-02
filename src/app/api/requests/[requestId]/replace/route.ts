import { NextResponse } from "next/server";
import { assertPending, authorizeRequest, createManagedRequest, requestView } from "@/lib/request-lifecycle";
import { appendRequestEvent, createRequestRecord, loadRequestRecord } from "@/lib/server-request-store";
import { vercelRequestStore } from "@/lib/vercel-request-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const { requestId } = await context.params;
    const input = await request.json() as Record<string, unknown>;
    const oldToken = String(input.managementToken ?? "");
    const store = vercelRequestStore(blobToken);
    const existing = await loadRequestRecord(requestId, store);
    if (!existing) return NextResponse.json({ state: "not-found" }, { status: 404 });
    authorizeRequest(existing.record, oldToken);
    const current = requestView(existing.record, existing.events);
    if (current.status === "replaced" && current.replacementRequestId) {
      return NextResponse.json({ requestId: current.replacementRequestId, view: current, idempotent: true });
    }
    assertPending(current);
    const obligationId = String(input.obligationId ?? "").trim();
    if (obligationId === existing.record.request.obligation?.id) throw new Error("Replacement requires a new obligation ID.");
    const replacementId = crypto.randomUUID();
    const managementToken = crypto.randomUUID();
    const replacement = createManagedRequest({
      requestId: replacementId, managementToken, createdAt: new Date().toISOString(), replacesRequestId: requestId,
      title: String(input.title ?? ""), amount: String(input.amount ?? ""), recipient: String(input.recipient ?? ""), route: String(input.route ?? ""),
      obligationKind: String(input.obligationKind ?? ""), obligationId,
    });
    await createRequestRecord(replacement, store);
    await appendRequestEvent(requestId, { type: "replaced", createdAt: new Date().toISOString(), replacementRequestId: replacementId }, "replacement", store);
    return NextResponse.json({ requestId: replacementId, managementToken, view: requestView(replacement, []) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not replace the request.";
    return NextResponse.json({ error: message }, { status: /settled|pending|Replacement/i.test(message) ? 409 : 400 });
  }
}
