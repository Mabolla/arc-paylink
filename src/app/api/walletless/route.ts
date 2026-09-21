import { NextResponse } from "next/server";
import { verifyClaimContext } from "@/lib/claim-validation";
import { createWalletlessRecord } from "@/lib/walletless-record";
import { createWalletlessRecordEntry } from "@/lib/server-walletless-store";
import { vercelRequestStore } from "@/lib/vercel-request-store";
import { isHex, verifyMessage } from "viem";
import { walletlessRegistrationMessage } from "@/lib/walletless-registration";
import { readJsonObject } from "@/lib/api-request";
import { createPublicClient, http } from "viem";
import { ARC_RPC_URL, arcChain } from "@/lib/arc";
import { verifyWalletlessTransactionEvidence } from "@/lib/walletless-transaction-validation";

export const runtime = "nodejs";

const receiptClient = createPublicClient({ chain: arcChain, transport: http(ARC_RPC_URL) });

export async function POST(request: Request) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return NextResponse.json({ state: "not-configured" }, { status: 503 });
  try {
    const input = await readJsonObject(request);
    const verified = await verifyClaimContext(input);
    if (typeof input.sender !== "string" || input.sender.toLowerCase() !== verified.sender.toLowerCase()) {
      throw new Error("Sender does not match the funded escrow.");
    }
    const registrationIssuedAt = String(input.registrationIssuedAt ?? "");
    const issuedAt = Date.parse(registrationIssuedAt);
    if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 10 * 60 * 1000) {
      throw new Error("Creator registration signature has expired.");
    }
    const registrationSignature = String(input.registrationSignature ?? "");
    if (!isHex(registrationSignature)) throw new Error("Creator registration signature is invalid.");
    const authorized = await verifyMessage({
      address: verified.sender,
      message: walletlessRegistrationMessage({
        sender: verified.sender,
        factory: verified.factory,
        paymentId: verified.paymentId,
        escrow: verified.escrow,
        recipientEmail: String(input.recipientEmail ?? ""),
        issuedAt: registrationIssuedAt,
      }),
      signature: registrationSignature,
    });
    if (!authorized) throw new Error("Creator registration was not signed by the escrow sender.");
    await verifyWalletlessTransactionEvidence(input, verified, receiptClient);
    const managementToken = String(input.managementToken ?? "");
    if (!/^0x[0-9a-f]{64}$/.test(managementToken)) throw new Error("Creator recovery token is invalid.");
    const record = createWalletlessRecord({ ...input, managementToken, createdAt: new Date().toISOString() });
    await createWalletlessRecordEntry(record, vercelRequestStore(blobToken));
    return NextResponse.json({ paymentId: record.paymentId, managementToken }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not register the PayLink." }, { status: 400 });
  }
}
