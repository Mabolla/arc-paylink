const DEFAULT_MAX_BYTES = 32 * 1024;

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new Error("Request URL is invalid.");
  }
  if (origin !== requestOrigin) throw new Error("Cross-origin API requests are not allowed.");
}

export async function readJsonObject(request: Request, maximumBytes = DEFAULT_MAX_BYTES): Promise<Record<string, unknown>> {
  assertSameOriginRequest(request);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("Content-Type must be application/json.");
  const length = request.headers.get("content-length");
  if (length && Number(length) > maximumBytes) throw new Error("Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error("Request body is too large.");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  return value as Record<string, unknown>;
}
