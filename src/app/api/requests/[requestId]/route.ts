import { NextResponse } from "next/server";
import { requestView } from "@/lib/request-lifecycle";
import { loadRequestRecord } from "@/lib/server-request-store";
import { vercelRequestStore } from "@/lib/vercel-request-store";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ requestId: string }> }) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  const { requestId } = await context.params;
  const result = await loadRequestRecord(requestId, vercelRequestStore(token));
  if (!result) return NextResponse.json({ state: "not-found" }, { status: 404 });
  return NextResponse.json({ view: requestView(result.record, result.events) });
}
