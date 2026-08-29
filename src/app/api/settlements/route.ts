import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { persistSettlementRecord } from "@/lib/server-settlement-store";
import { validateSettlementCorrelationRecord } from "@/lib/validate-settlement-record";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ state: "not-configured" }, { status: 503 });

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Settlement record is too large." }, { status: 413 });
    }
    const record = validateSettlementCorrelationRecord(JSON.parse(body));
    const state = await persistSettlementRecord(record, {
      async list(prefix) {
        const result = await list({ prefix, limit: 2, token });
        return result.blobs.map((blob) => blob.pathname);
      },
      async put(pathname, contents) {
        await put(pathname, contents, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/json",
          token,
        });
      },
    });
    return NextResponse.json({ state, correlationId: record.correlationId }, { status: state === "created" ? 201 : state === "conflict" ? 409 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Settlement record must be valid JSON." }, { status: 400 });
    if (error instanceof Error && /Settlement|Obligation|Source|CCTP|Destination|Recovery|Event|amount|fee|block|Correlation/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Shared settlement storage is temporarily unavailable." }, { status: 503 });
  }
}
