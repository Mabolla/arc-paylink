import { NextResponse } from "next/server";
import { initializeArcUserWallet, isCircleUserToken } from "@/lib/circle-wallets";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userToken =
    body && typeof body === "object" && "userToken" in body
      ? (body as { userToken?: unknown }).userToken
      : undefined;

  if (!isCircleUserToken(userToken)) {
    return NextResponse.json({ error: "Invalid Circle user token" }, { status: 400 });
  }

  try {
    const result = await initializeArcUserWallet(userToken);
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Circle wallet initialization failed" }, { status: 502 });
  }
}
