import { createPublicClient, getAddress, http, isHash, type Hash } from "viem";
import {
  ARC_CHAIN_ID,
  ARC_USDC_ADDRESS,
  IS_ARC_MAINNET,
  arcChain,
} from "../arc";
import { parseUsdcAmount } from "../amount";
import { verifyTransferLog } from "../verify-payment";
import { CommerceError } from "./store";
import type { CheckoutProvider } from "./payments";
import { uuid } from "./service";

export async function circleRequest<T>(
  path: string,
  userToken?: string,
  body?: unknown,
): Promise<T> {
  const key = process.env.CIRCLE_API_KEY;
  if (!key)
    throw new CommerceError(
      "Embedded checkout is not configured on this deployment.",
      503,
    );
  const response = await fetch(`https://api.circle.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(userToken ? { "X-User-Token": userToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new CommerceError(
      `Circle could not complete the request (${response.status}). Resume with the same account; do not start another payment.`,
      response.status === 401 ? 401 : 502,
    );
  return payload.data as T;
}

export function circleCheckoutProvider(): CheckoutProvider {
  const client = createPublicClient({
    chain: arcChain,
    transport: http(undefined, { timeout: 12000, retryCount: 1 }),
  });
  const blockchain =
    process.env.CIRCLE_ARC_BLOCKCHAIN ||
    (IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET");
  return {
    async wallet(userToken, walletId) {
      const { wallets } = await circleRequest<{
        wallets: { id: string; address: string; blockchain: string }[];
      }>("/v1/w3s/wallets", userToken);
      const wallet = wallets?.find(
        (w) => w.id === walletId && w.blockchain === blockchain,
      );
      if (!wallet)
        throw new CommerceError(
          "This session does not own the payment wallet on the selected Arc network.",
          403,
        );
      return { id: wallet.id, address: getAddress(wallet.address) };
    },
    async prepare(userToken, order) {
      const result = await circleRequest<{ challengeId: string }>(
        "/v1/w3s/user/transactions/contractExecution",
        userToken,
        {
          idempotencyKey: order.attempt!.idempotencyKey,
          walletId: order.attempt!.walletId,
          contractAddress: ARC_USDC_ADDRESS,
          abiFunctionSignature: "transfer(address,uint256)",
          abiParameters: [
            order.recipient,
            parseUsdcAmount(order.amount).toString(),
          ],
          feeLevel: "MEDIUM",
          refId: `apc:${order.id}`,
        },
      );
      return result.challengeId;
    },
    async transaction(userToken, order) {
      const { challenge } = await circleRequest<{
        challenge: { id: string; status: string; correlationIds?: string[] };
      }>(
        `/v1/w3s/user/challenges/${uuid.parse(order.attempt!.challengeId)}`,
        userToken,
      );
      if (challenge.id !== order.attempt!.challengeId)
        throw new CommerceError("Circle returned a different approval.", 502);
      const ids = challenge.correlationIds ?? [];
      if (ids.length > 5)
        throw new CommerceError("Payment requires manual reconciliation.", 409);
      for (const id of ids) {
        const { transaction: tx } = await circleRequest<{
          transaction: {
            id: string;
            walletId: string;
            blockchain: string;
            refId?: string;
            txHash?: string;
            state: string;
          };
        }>(`/v1/w3s/transactions/${uuid.parse(id)}`, userToken);
        if (
          tx.walletId !== order.attempt!.walletId ||
          tx.blockchain !== blockchain ||
          tx.refId !== `apc:${order.id}`
        )
          throw new CommerceError(
            "Circle transaction does not belong to this checkout.",
            409,
          );
        if (
          tx.txHash &&
          isHash(tx.txHash) &&
          ["CONFIRMED", "COMPLETE"].includes(tx.state)
        )
          return tx.txHash as Hash;
      }
      return undefined;
    },
    async transactionIds(userToken, challengeId) {
      const { challenge } = await circleRequest<{
        challenge: { id: string; correlationIds?: string[] };
      }>(`/v1/w3s/user/challenges/${uuid.parse(challengeId)}`, userToken);
      if (
        challenge.id !== challengeId ||
        (challenge.correlationIds?.length ?? 0) > 5
      )
        throw new CommerceError(
          "Circle approval could not be correlated.",
          502,
        );
      return (challenge.correlationIds ?? []).map((id) => uuid.parse(id));
    },
    async verify(hash, order) {
      if (
        order.chainId !== ARC_CHAIN_ID ||
        (await client.getChainId()) !== ARC_CHAIN_ID
      )
        throw new CommerceError("RPC network mismatch.", 502);
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase())
        throw new CommerceError("RPC receipt mismatch.", 502);
      const proof = verifyTransferLog(receipt, {
        recipient: order.recipient,
        amountBaseUnits: parseUsdcAmount(order.amount),
      });
      const block = await client.getBlock({ blockHash: receipt.blockHash });
      return {
        ...proof,
        transactionHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        timestamp: Number(block.timestamp),
      };
    },
  };
}
