import { readJsonObject, assertSameOriginRequest } from "@/lib/api-request";
import {
  commerce,
  credential,
  failure,
  json,
  withSession,
} from "@/lib/commerce/http";
import { merchantOrder } from "@/lib/commerce/service";
import { monitorStatus, runOwnerMonitorRefresh } from "@/lib/commerce/monitor-http";
import { CommerceError } from "@/lib/commerce/store";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ path?: string[] }> };
export async function GET(request: Request, context: Context) {
  try {
    const path = (await context.params).path ?? [];
    if (path[0] === "config")
      return json({
        storageReady: !!process.env.BLOB_READ_WRITE_TOKEN,
        embeddedWalletReady: !!(
          process.env.CIRCLE_API_KEY &&
          process.env.NEXT_PUBLIC_CIRCLE_APP_ID &&
          process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
        ),
      });
    const service = commerce();
    const principal = await service.authorize(credential(request));
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    if (cursor && cursor.length > 2048)
      throw new CommerceError("Invalid page cursor.");
    if (!path.length || path[0] === "session")
      return json({ workspace: principal.workspace, role: principal.key.role });
    if (path.length === 1 && path[0] === "monitor")
      return json(await monitorStatus(service, principal));
    if (path[0] === "summary") return json(await service.summary(principal));
    if (path[0] === "keys")
      return json({ keys: await service.keys(principal) });
    if (path[0] === "events")
      return json(await service.events(principal, cursor));
    if (path[0] === "orders") {
      if (path[1])
        return json({
          order: merchantOrder(await service.order(principal, path[1])),
        });
      const page = await service.listOrders(principal, cursor);
      return json({ ...page, orders: page.orders.map(merchantOrder) });
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const path = (await context.params).path ?? [];
    const body = await readJsonObject(request);
    const service = commerce();
    if (path[0] === "workspaces") {
      const created = await service.createWorkspace(body);
      return withSession(json(created, 201), request, created.token);
    }
    if (path[0] === "session") {
      const token = typeof body.token === "string" ? body.token : "";
      const principal = await service.authorize(token);
      if (principal.key.role !== "owner")
        throw new CommerceError(
          "Use your owner recovery key to open the business dashboard.",
          403,
        );
      return withSession(
        json({ workspace: principal.workspace }),
        request,
        token,
      );
    }
    const principal = await service.authorize(credential(request));
    if (path.length === 2 && path[0] === "monitor" && path[1] === "refresh")
      return json(await runOwnerMonitorRefresh(service, principal, body));
    if (path[0] === "orders" && !path[1])
      return json(
        { order: merchantOrder(await service.createOrder(principal, body)) },
        201,
      );
    if (path[0] === "orders" && path[2] === "cancel")
      return json({
        order: merchantOrder(await service.cancel(principal, path[1])),
      });
    if (path[0] === "keys" && !path[1])
      return json(await service.issueReader(principal, body.name), 201);
    if (path[0] === "keys" && path[2] === "revoke") {
      await service.revokeKey(principal, path[1]);
      return json({ revoked: true });
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const response = withSession(json({ signedOut: true }), request, "");
    response.cookies.set("arcpaylink_business", "", {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "strict",
      path: "/api/business",
      maxAge: 0,
    });
    return response;
  } catch (e) {
    return failure(e);
  }
}
