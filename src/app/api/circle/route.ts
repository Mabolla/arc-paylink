import { NextResponse } from "next/server";

const CIRCLE_BASE_URL = "https://api.circle.com";

type CircleAction = "createDeviceToken" | "initializeUser" | "listWallets";

function apiKey() {
  const value = process.env.CIRCLE_API_KEY?.trim();
  if (!value) throw new Error("Circle API key is not configured.");
  return value;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

async function circleFetch(path: string, init: RequestInit) {
  const response = await fetch(`${CIRCLE_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({ message: "Circle returned an unreadable response." }));
  return NextResponse.json(response.ok ? payload.data : payload, { status: response.status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = requiredString(body.action, "action") as CircleAction;

    if (action === "createDeviceToken") {
      const deviceId = requiredString(body.deviceId, "deviceId");
      return circleFetch("/v1/w3s/users/social/token", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), deviceId }),
      });
    }

    const userToken = requiredString(body.userToken, "userToken");
    const userHeaders = { "X-User-Token": userToken };

    if (action === "initializeUser") {
      return circleFetch("/v1/w3s/user/initialize", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          accountType: "SCA",
          blockchains: ["ARC-TESTNET"],
        }),
      });
    }

    if (action === "listWallets") {
      return circleFetch("/v1/w3s/wallets", { method: "GET", headers: userHeaders });
    }

    return NextResponse.json({ message: "Unsupported Circle action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Circle request failed.";
    const status = message === "Circle API key is not configured." ? 503 : 400;
    return NextResponse.json({ message }, { status });
  }
}
