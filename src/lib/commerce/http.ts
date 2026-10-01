import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommerceError, blobCommerceStore } from "./store";
import { CommerceService } from "./service";

export const SESSION_COOKIE = "arcpaylink_business";
export const commerce = () => new CommerceService(blobCommerceStore());
export function credential(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization)
    return authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : undefined;
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store", Vary: "Cookie, Authorization" },
  });
}
export function failure(error: unknown) {
  if (error instanceof CommerceError)
    return json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return json(
      {
        error: "Check the submitted fields.",
        fields: error.issues.map((i) => i.path.join(".")),
      },
      400,
    );
  // Provider responses, tokens and storage implementation details must not reach clients.
  return json(
    {
      error:
        "The service could not finish this operation. Refresh and retry the same operation.",
    },
    503,
  );
}
export function withSession(
  response: NextResponse,
  request: Request,
  token: string,
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "strict",
    path: "/api/business",
    maxAge: 7 * 86400,
  });
  return response;
}
