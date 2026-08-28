const DEFAULT_CIRCLE_BASE_URL = "https://api.circle.com";

export type CircleWalletEnvironment = {
  CIRCLE_API_KEY?: string;
  CIRCLE_BASE_URL?: string;
};

export type CircleUserInitialization = {
  challengeId: string;
};

type CircleEnvelope<T> = {
  data?: T;
  code?: number;
  message?: string;
};

export function getCircleWalletConfig(
  env: CircleWalletEnvironment = process.env as CircleWalletEnvironment,
) {
  const apiKey = env.CIRCLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Circle Wallets is not configured");
  }

  const baseUrl = (env.CIRCLE_BASE_URL?.trim() || DEFAULT_CIRCLE_BASE_URL).replace(/\/$/, "");
  if (!baseUrl.startsWith("https://")) {
    throw new Error("Circle base URL must use HTTPS");
  }

  return { apiKey, baseUrl };
}

export function isCircleUserToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 8192;
}

export async function initializeArcUserWallet(
  userToken: string,
  options: {
    env?: CircleWalletEnvironment;
    fetcher?: typeof fetch;
    idempotencyKey?: string;
  } = {},
): Promise<CircleUserInitialization> {
  if (!isCircleUserToken(userToken)) {
    throw new Error("Invalid Circle user token");
  }

  const { apiKey, baseUrl } = getCircleWalletConfig(options.env);
  const response = await (options.fetcher ?? fetch)(`${baseUrl}/v1/w3s/user/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-User-Token": userToken,
    },
    body: JSON.stringify({
      idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
      accountType: "SCA",
      blockchains: ["ARC-TESTNET"],
    }),
  });

  const payload = (await response.json()) as CircleEnvelope<CircleUserInitialization>;
  if (!response.ok) {
    throw new Error(payload.message || `Circle Wallets request failed (${response.status})`);
  }
  if (!payload.data?.challengeId) {
    throw new Error("Circle Wallets returned no challenge ID");
  }

  return payload.data;
}
