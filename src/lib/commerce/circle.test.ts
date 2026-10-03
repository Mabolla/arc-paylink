import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeAbiParameters, erc20Abi } from "viem";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS, IS_ARC_MAINNET } from "../arc";
import type { Order } from "./types";
const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => rpc,
}));
import { circleCheckoutProvider } from "./circle";
const walletId = "715592c1-7f37-4a6f-896c-2488df517cf6";
const challengeId = "6a44477f-35c1-4bdf-80f6-293fed7c615a";
const txId = "95f49099-854e-4d45-8aa5-2ecf3f09854e";
const sender = "0x2222222222222222222222222222222222222222";
const recipient = "0x1111111111111111111111111111111111111111";
const hash = `0x${"a".repeat(64)}` as const;
const order: Order = {
  id: "820c8e91-7ad0-4a5c-a6f2-1874be5fa82a",
  merchantId: "ba5213b8-85b6-48f6-9864-ad9014526349",
  merchantName: "QA",
  title: "Service",
  reference: "QA-1",
  amount: "5",
  recipient,
  chainId: ARC_CHAIN_ID,
  createdAt: "2026-10-01T00:00:00Z",
  customerReference: "",
  fingerprint: "",
  status: "processing",
  attempt: {
    walletId,
    walletAddress: sender,
    idempotencyKey: "9eb7fe12-2a2a-4c0c-9e33-998788929db3",
    startedAt: "2026-10-01T00:00:00Z",
    challengeId,
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Circle embedded checkout adapter", () => {
  it("binds wallet ownership and sends the immutable order amount, recipient and retry identity", async () => {
    vi.stubEnv("CIRCLE_API_KEY", "fake-test-key");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            wallets: [
              {
                id: walletId,
                address: sender,
                blockchain: IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: { challengeId } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = circleCheckoutProvider();
    expect((await provider.wallet("user-session", walletId)).address).toBe(
      sender,
    );
    await provider.prepare("user-session", order);
    const options = fetcher.mock.calls[1][1];
    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({
      contractAddress: ARC_USDC_ADDRESS,
      abiParameters: [recipient, "5000000"],
      idempotencyKey: order.attempt!.idempotencyKey,
      refId: `apc:${order.id}`,
    });
    expect(options.headers["X-User-Token"]).toBe("user-session");
    expect(options.redirect).toBe("error");
  });
  it("accepts only the saved challenge's correctly correlated transaction", async () => {
    vi.stubEnv("CIRCLE_API_KEY", "fake-test-key");
    const fetcher = vi
      .fn()
      .mockImplementation(async (url: string) =>
        Response.json({
          data: url.includes("challenges")
            ? { challenge: { id: challengeId, correlationIds: [txId] } }
            : {
                transaction: {
                  walletId,
                  blockchain: IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET",
                  refId: "apc:WRONG",
                  txHash: hash,
                  state: "COMPLETE",
                },
              },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      circleCheckoutProvider().transaction("session", order),
    ).rejects.toThrow("does not belong");
  });
  it("verifies the actual USDC event and RPC chain, not only provider status", async () => {
    rpc.getChainId.mockResolvedValue(ARC_CHAIN_ID);
    rpc.getBlock.mockResolvedValue({ timestamp: 1790812801n });
    const log = {
      address: ARC_USDC_ADDRESS,
      topics: encodeEventTopics({
        abi: erc20Abi,
        eventName: "Transfer",
        args: { from: sender, to: recipient },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [5000000n]),
    };
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: hash,
      blockNumber: 100n,
      blockHash: hash,
      logs: [log],
    });
    expect(await circleCheckoutProvider().verify(hash, order)).toMatchObject({
      sender,
      transactionHash: hash,
      blockNumber: "100",
    });
    rpc.getChainId.mockResolvedValue(1);
    await expect(circleCheckoutProvider().verify(hash, order)).rejects.toThrow(
      "network mismatch",
    );
    rpc.getChainId.mockResolvedValue(ARC_CHAIN_ID);
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: hash,
      logs: [
        {
          ...log,
          data: encodeAbiParameters([{ type: "uint256" }], [4900000n]),
        },
      ],
    });
    await expect(circleCheckoutProvider().verify(hash, order)).rejects.toThrow(
      "No matching",
    );
  });
});
