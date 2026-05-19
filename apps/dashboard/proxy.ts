import { NextResponse, type NextRequest } from "next/server";
import { normalizeRequestId, REQUEST_ID_HEADER } from "./lib/request-id";

export function proxy(request: NextRequest) {
  const requestId = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER))
    ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
  response.headers.set("X-Request-Id", requestId);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
