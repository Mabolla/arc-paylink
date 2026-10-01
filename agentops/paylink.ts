import { getAddress, isAddress, isHash } from "viem";
import { z } from "zod";
import { parseUsdcAmount } from "../src/lib/amount";
import type { RequestView } from "../src/lib/request-lifecycle";

export const PaylinkViewSchema = z.object({
  requestId: z.string().uuid(),
  request: z.object({
    title: z.string().min(1).max(80),
    amount: z.string().max(32).refine((value) => { try { parseUsdcAmount(value); return true; } catch { return false; } }),
    recipient: z.string().refine((value) => isAddress(value, { strict: false })).transform((value) => getAddress(value)),
    route: z.enum(["arc", "bridge"]),
    chainId: z.number().int().positive(),
    obligation: z.object({ kind: z.enum(["invoice", "milestone", "agent-task"]), id: z.string().min(1).max(120) }).optional(),
  }),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  status: z.enum(["pending", "settled", "revoked", "replaced"]),
  transactionHash: z.string().refine(isHash).optional(),
  replacementRequestId: z.string().uuid().optional(),
  replacesRequestId: z.string().uuid().optional(),
});

function endpoint(baseUrl: string, requestId: string) {
  if (!z.string().uuid().safeParse(requestId).success) throw new Error("PayLink request ID is invalid.");
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("Configure only the PayLink origin, without credentials, query, fragment or path.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("PayLink requires HTTPS except on localhost.");
  return `${url.origin}/api/requests/${encodeURIComponent(requestId)}`;
}

async function readView(response: Response, requestId: string): Promise<RequestView> {
  if (!response.ok) throw new Error(`PayLink service returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => ({})) as { view?: unknown };
  const parsed = PaylinkViewSchema.safeParse(payload.view);
  if (!parsed.success || parsed.data.requestId.toLowerCase() !== requestId.toLowerCase()) throw new Error("PayLink returned an invalid or mismatched request.");
  return parsed.data as RequestView;
}

export async function loadPaylinkRequest(baseUrl: string, requestId: string, fetcher: typeof fetch = fetch): Promise<RequestView> {
  const response = await fetcher(endpoint(baseUrl, requestId), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  return readView(response, requestId);
}

export async function recordVerifiedPaylinkSettlement(input: {
  baseUrl: string;
  requestId: string;
  transactionHash: string;
  fetcher?: typeof fetch;
}): Promise<RequestView> {
  if (!isHash(input.transactionHash)) throw new Error("Settlement transaction hash is invalid.");
  const response = await (input.fetcher ?? fetch)(`${endpoint(input.baseUrl, input.requestId)}/settle`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ transactionHash: input.transactionHash }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
  });
  const view = await readView(response, input.requestId);
  if (view.status !== "settled" || view.transactionHash?.toLowerCase() !== input.transactionHash.toLowerCase()) {
    throw new Error("PayLink did not record this transaction as the request's settlement.");
  }
  return view;
}
