import { isAddress, isHex, keccak256 } from "viem";
import { NextResponse } from "next/server";
import { verifyClaimContext, type VerifiedClaimContext } from "@/lib/claim-validation";

const CIRCLE_BASE_URL = "https://api.circle.com";
const ARC_CHAIN_ID = 5_042_002;
const ARC_BLOCKCHAIN = "ARC-TESTNET";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const CLAIM_WINDOW_SECONDS = 15 * 60;

type CircleAction =
  | "createDeviceToken"
  | "initializeUser"
  | "listWallets"
  | "inspectChallenge"
  | "deployWallet"
  | "signClaim"
  | "executeClaim";

type CircleResponse = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
};

function apiKey() {
  const value = process.env.CIRCLE_API_KEY?.trim();
  if (!value) throw new Error("Circle API key is not configured.");
  return value;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}.`);
  return value.trim();
}

function claimWallet(value: unknown) {
  const address = requiredString(value, "walletAddress");
  if (!isAddress(address)) throw new Error("Recipient wallet address is invalid.");
  return address;
}

function claimDeadline(value: unknown, claim: VerifiedClaimContext) {
  const deadline = Number(value);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(deadline) || deadline < now || deadline >= claim.expiry) {
    throw new Error("The claim authorization has expired.");
  }
  return deadline;
}

async function circleRequest(path: string, init: RequestInit): Promise<CircleResponse> {
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
  return {
    ok: response.ok,
    status: response.status,
    payload: (response.ok ? payload.data : payload) as Record<string, unknown>,
  };
}

function circleResponse(result: CircleResponse) {
  return NextResponse.json(result.payload, { status: result.status });
}

async function assertWalletOwnership(userToken: string, walletId: string, walletAddress: string) {
  const result = await circleRequest("/v1/w3s/wallets", {
    method: "GET",
    headers: { "X-User-Token": userToken },
  });
  if (!result.ok) return result;

  const wallets = Array.isArray(result.payload.wallets) ? result.payload.wallets : [];
  const ownsWallet = wallets.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const wallet = entry as Record<string, unknown>;
    return wallet.id === walletId
      && typeof wallet.address === "string"
      && wallet.address.toLowerCase() === walletAddress.toLowerCase()
      && wallet.blockchain === ARC_BLOCKCHAIN;
  });
  if (!ownsWallet) throw new Error("Circle session does not own the recipient wallet.");
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = requiredString(body.action, "action") as CircleAction;

    if (action === "createDeviceToken") {
      const deviceId = requiredString(body.deviceId, "deviceId");
      return circleResponse(await circleRequest("/v1/w3s/users/social/token", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), deviceId }),
      }));
    }

    const userToken = requiredString(body.userToken, "userToken");
    const userHeaders = { "X-User-Token": userToken };

    if (action === "initializeUser") {
      return circleResponse(await circleRequest("/v1/w3s/user/initialize", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          accountType: "SCA",
          blockchains: [ARC_BLOCKCHAIN],
        }),
      }));
    }

    if (action === "listWallets") {
      return circleResponse(await circleRequest("/v1/w3s/wallets", { method: "GET", headers: userHeaders }));
    }

    if (action === "inspectChallenge") {
      const challengeId = requiredString(body.challengeId, "challengeId");
      return circleResponse(await circleRequest(`/v1/w3s/user/challenges/${encodeURIComponent(challengeId)}`, {
        method: "GET",
        headers: userHeaders,
      }));
    }

    const walletId = requiredString(body.walletId, "walletId");
    const walletAddress = claimWallet(body.walletAddress);
    const ownershipError = await assertWalletOwnership(userToken, walletId, walletAddress);
    if (ownershipError) return circleResponse(ownershipError);

    const claim = await verifyClaimContext(body);

    if (action === "deployWallet") {
      return circleResponse(await circleRequest("/v1/w3s/user/transactions/contractExecution", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          walletId,
          contractAddress: ARC_USDC,
          abiFunctionSignature: "transfer(address,uint256)",
          abiParameters: [walletAddress, "0"],
          feeLevel: "MEDIUM",
          refId: "arc-paylink-wallet-deployment",
        }),
      }));
    }

    if (action === "signClaim") {
      const now = Math.floor(Date.now() / 1000);
      const deadline = Math.min(now + CLAIM_WINDOW_SECONDS, claim.expiry - 1);
      if (deadline <= now) throw new Error("This PayLink has expired.");
      const typedData = {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          Claim: [
            { name: "escrow", type: "address" },
            { name: "recipient", type: "address" },
            { name: "secretHash", type: "bytes32" },
            { name: "deadline", type: "uint256" },
          ],
        },
        domain: { name: "Arc PayLink", version: "1", chainId: ARC_CHAIN_ID, verifyingContract: claim.escrow },
        primaryType: "Claim",
        message: {
          escrow: claim.escrow,
          recipient: walletAddress,
          secretHash: claim.secretHash,
          deadline,
        },
      };
      const result = await circleRequest("/v1/w3s/user/sign/typedData", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          walletId,
          data: JSON.stringify(typedData),
        }),
      });
      return NextResponse.json(result.ok ? { ...result.payload, deadline } : result.payload, { status: result.status });
    }

    if (action === "executeClaim") {
      const deadline = claimDeadline(body.deadline, claim);
      const secret = requiredString(body.secret, "secret");
      const signature = requiredString(body.signature, "signature");
      if (!isHex(secret) || secret.length !== 66 || keccak256(secret) !== claim.secretHash) {
        throw new Error("Claim package secret does not match this PayLink.");
      }
      if (!isHex(signature)) throw new Error("Circle returned an invalid claim signature.");
      return circleResponse(await circleRequest("/v1/w3s/user/transactions/contractExecution", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          walletId,
          contractAddress: claim.escrow,
          abiFunctionSignature: "claim(bytes32,address,uint256,bytes)",
          abiParameters: [secret, walletAddress, String(deadline), signature],
          feeLevel: "MEDIUM",
          refId: "arc-paylink-recipient-claim",
        }),
      }));
    }

    return NextResponse.json({ message: "Unsupported Circle action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Circle request failed.";
    const status = message === "Circle API key is not configured." ? 503 : 400;
    return NextResponse.json({ message }, { status });
  }
}
