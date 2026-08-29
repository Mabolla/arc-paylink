import { get, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createObligation } from "@/lib/obligation";
import { findSettlementRecord } from "@/lib/server-settlement-store";
import { validateSettlementCorrelationRecord } from "@/lib/validate-settlement-record";

export const runtime = "nodejs";
const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const input = (await request.json()) as { correlationId?: unknown; obligationKind?: unknown; obligationId?: unknown };
    if (typeof input.correlationId !== "string" || !HASH.test(input.correlationId)) {
      return NextResponse.json({ error: "Enter a valid correlation ID." }, { status: 400 });
    }
    const obligation = createObligation({
      kind: typeof input.obligationKind === "string" ? input.obligationKind : undefined,
      id: typeof input.obligationId === "string" ? input.obligationId : undefined,
    });
    if (!obligation) return NextResponse.json({ error: "Enter the exact obligation reference." }, { status: 400 });

    const result = await findSettlementRecord(input.correlationId, obligation, {
      async list(prefix) {
        const result = await list({ prefix, limit: 2, token });
        return result.blobs.map((blob) => blob.pathname);
      },
      async read(pathname) {
        const result = await get(pathname, { access: "private", useCache: false, token });
        if (!result || result.statusCode !== 200) return undefined;
        return JSON.parse(await new Response(result.stream).text());
      },
    });
    if (result === "not-found") return NextResponse.json({ state: "not-found" }, { status: 404 });
    if (result === "conflict") return NextResponse.json({ state: "conflict" }, { status: 409 });
    const record = validateSettlementCorrelationRecord(result);
    return NextResponse.json({ state: "verified", record });
  } catch (error) {
    if (error instanceof Error && /Obligation|valid correlation/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Settlement lookup is temporarily unavailable." }, { status: 503 });
  }
}
