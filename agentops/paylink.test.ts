import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { loadPaylinkRequest, recordVerifiedPaylinkSettlement } from "./paylink";

const requestId = "3a6f27e8-f6bd-43b2-9921-8b26e8b60890";
const hash = `0x${"a".repeat(64)}`;
const view = {
  requestId,
  request: { title: "Invoice", amount: "5", recipient: getAddress("0x00000000000000000000000000000000000000a1"), route: "arc", chainId: 5042002 },
  createdAt: "2026-10-01T10:00:00.000Z",
  status: "settled",
  transactionHash: hash,
} as const;

describe("PayLink settlement synchronization", () => {
  it("records and checks the exact verified Arc transaction in PayLink", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ view }), { status: 200 }));
    await expect(recordVerifiedPaylinkSettlement({ baseUrl: "https://paylink.example/", requestId, transactionHash: hash, fetcher })).resolves.toEqual(view);
    expect(fetcher).toHaveBeenCalledWith("https://paylink.example/api/requests/3a6f27e8-f6bd-43b2-9921-8b26e8b60890/settle", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ transactionHash: hash }),
    }));
  });

  it("refuses a server response that points at another settlement", async () => {
    const differentHash = `0x${"b".repeat(64)}`;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ view: { ...view, transactionHash: differentHash } }), { status: 200 }));
    await expect(recordVerifiedPaylinkSettlement({ baseUrl: "https://paylink.example", requestId, transactionHash: hash, fetcher })).rejects.toThrow("did not record this transaction");
  });

  it("does not treat API failure as an unverified chain payment", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "conflict" }), { status: 409 }));
    await expect(recordVerifiedPaylinkSettlement({ baseUrl: "https://paylink.example", requestId, transactionHash: hash, fetcher })).rejects.toThrow("HTTP 409");
  });

  it("rejects mismatched request identities and malformed monetary facts", async () => {
    for (const invalid of [{ ...view, requestId: "bb6f27e8-f6bd-43b2-9921-8b26e8b60890" }, { ...view, request: { ...view.request, amount: "1e6" } }]) {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ view: invalid })));
      await expect(loadPaylinkRequest("https://paylink.example", requestId, fetcher)).rejects.toThrow("invalid or mismatched");
    }
  });

  it("blocks insecure origins and embedded credentials before network access", async () => {
    const fetcher = vi.fn();
    for (const url of ["http://paylink.example", "https://secret@paylink.example", "https://paylink.example/other"]) {
      await expect(loadPaylinkRequest(url, requestId, fetcher)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
