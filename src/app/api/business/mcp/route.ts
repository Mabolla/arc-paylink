import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { assertSameOriginRequest } from "@/lib/api-request";
import { commerce, failure } from "@/lib/commerce/http";
import { CommerceError } from "@/lib/commerce/store";
import { createMerchantMcp } from "@/lib/commerce/mcp";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    // Remote agents must explicitly authenticate: browser cookies are not accepted here.
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new CommerceError("A business agent Bearer key is required.", 401);
    const service = commerce();
    const principal = await service.authorize(authorization.slice(7));
    const server = createMerchantMcp(service, principal);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 32768,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } finally {
      await server.close();
    }
  } catch (e) {
    return failure(e);
  }
}
