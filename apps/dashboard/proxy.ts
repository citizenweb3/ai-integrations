import { NextResponse, type NextRequest } from "next/server";
import { normalizeRequestId, REQUEST_ID_HEADER } from "./lib/request-id";

export function proxy(request: NextRequest) {
  const requestId = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER))
    ?? crypto.randomUUID();

  const authResponse = authorizeDashboardRequest(request, requestId);
  if (authResponse) return authResponse;

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

function authorizeDashboardRequest(request: NextRequest, requestId: string): NextResponse | null {
  if (isWebhookPath(request.nextUrl.pathname)) return null;

  const username = process.env.DASHBOARD_BASIC_AUTH_USERNAME?.trim() ?? "";
  const password = process.env.DASHBOARD_BASIC_AUTH_PASSWORD?.trim() ?? "";
  if (!username && !password) return null;

  const requestIdHeaders = { [REQUEST_ID_HEADER]: requestId };
  if (!username || !password) {
    return NextResponse.json(
      { error: "dashboard basic auth is misconfigured" },
      { status: 503, headers: requestIdHeaders }
    );
  }

  if (isBasicAuthMatch(request.headers.get("authorization"), username, password)) {
    return null;
  }

  return NextResponse.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        ...requestIdHeaders,
        "WWW-Authenticate": 'Basic realm="BizDev Dashboard", charset="UTF-8"'
      }
    }
  );
}

function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith("/webhooks/");
}

function isBasicAuthMatch(header: string | null, username: string, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return decoded.slice(0, separator) === username
      && decoded.slice(separator + 1) === password;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
