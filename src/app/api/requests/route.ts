import { NextResponse } from "next/server";
import { createManagedRequest } from "@/lib/request-lifecycle";
import { createRequestRecord } from "@/lib/server-request-store";
import { vercelRequestStore } from "@/lib/vercel-request-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const input = await request.json() as Record<string, unknown>;
    const requestId = crypto.randomUUID();
    const managementToken = crypto.randomUUID();
    const record = createManagedRequest({
      requestId,
      managementToken,
      createdAt: new Date().toISOString(),
      title: String(input.title ?? ""),
      amount: String(input.amount ?? ""),
      recipient: String(input.recipient ?? ""),
      route: String(input.route ?? ""),
      obligationKind: String(input.obligationKind ?? ""),
      obligationId: String(input.obligationId ?? ""),
    });
    await createRequestRecord(record, vercelRequestStore(blobToken));
    return NextResponse.json({ requestId, managementToken, view: { requestId, request: record.request, createdAt: record.createdAt, status: "pending" } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the request." }, { status: 400 });
  }
}
