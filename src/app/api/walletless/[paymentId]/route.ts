import { NextResponse } from "next/server";
import { authorizeWalletlessRecord, walletlessCreatorView } from "@/lib/walletless-record";
import { loadWalletlessRecord } from "@/lib/server-walletless-store";
import { vercelRequestStore } from "@/lib/vercel-request-store";
import { readJsonObject } from "@/lib/api-request";
import { ARC_PAYLINK_FACTORY, ARC_PAYLINK_LEGACY_FACTORIES, isTrustedArcPayLinkFactory } from "@/lib/claim-package";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ paymentId: string }> }) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const { paymentId } = await context.params;
    const record = await loadWalletlessRecord(paymentId, vercelRequestStore(blobToken));
    if (!record || !record.encryptedClaimBackup) throw new Error("Recoverable PayLink not found.");
    const factory = record.factory ?? (ARC_PAYLINK_LEGACY_FACTORIES.length === 1 ? ARC_PAYLINK_LEGACY_FACTORIES[0] : ARC_PAYLINK_FACTORY);
    if (!factory || !isTrustedArcPayLinkFactory(factory)) throw new Error("Recoverable PayLink factory is unavailable.");
    return NextResponse.json({
      recovery: {
        factory,
        paymentId: record.paymentId,
        escrow: record.escrow,
        sender: record.sender,
      },
    });
  } catch {
    return NextResponse.json({ error: "Recoverable PayLink not found." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ paymentId: string }> }) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const { paymentId } = await context.params;
    const body = await readJsonObject(request);
    const record = await loadWalletlessRecord(paymentId, vercelRequestStore(blobToken));
    if (!record) throw new Error("PayLink not found.");
    authorizeWalletlessRecord(record, String(body.managementToken ?? ""));
    return NextResponse.json({ view: walletlessCreatorView(record) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PayLink not found." }, { status: 404 });
  }
}
