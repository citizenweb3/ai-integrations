import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { createDashboardLogger } from "../../../apps/dashboard/lib/logger";
import { runWithRequestContext } from "../../../apps/dashboard/lib/request-context";
import { proxy } from "../../../apps/dashboard/proxy";

test("request id middleware preserves inbound request id", () => {
  const request = new NextRequest("https://example.com/inbox", {
    headers: {
      "x-request-id": "req-t011-inbound"
    }
  });

  const response = proxy(request);

  assert.equal(response.headers.get("x-request-id"), "req-t011-inbound");
});

test("request id middleware creates a request id when missing", () => {
  const request = new NextRequest("https://example.com/inbox");

  const response = proxy(request);
  const requestId = response.headers.get("x-request-id");

  assert.match(requestId ?? "", /^[0-9a-f-]{36}$/);
});

test("dashboard basic auth protects operator routes when configured", () => {
  const originalUser = process.env.DASHBOARD_BASIC_AUTH_USERNAME;
  const originalPassword = process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  process.env.DASHBOARD_BASIC_AUTH_USERNAME = "operator";
  process.env.DASHBOARD_BASIC_AUTH_PASSWORD = "secret";
  try {
    const response = proxy(new NextRequest("https://example.com/operations", {
      headers: { "x-request-id": "req-auth-missing" }
    }));

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("x-request-id"), "req-auth-missing");
    assert.match(response.headers.get("www-authenticate") ?? "", /Basic/);
  } finally {
    restoreDashboardAuthEnv(originalUser, originalPassword);
  }
});

test("dashboard basic auth accepts valid credentials", () => {
  const originalUser = process.env.DASHBOARD_BASIC_AUTH_USERNAME;
  const originalPassword = process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  process.env.DASHBOARD_BASIC_AUTH_USERNAME = "operator";
  process.env.DASHBOARD_BASIC_AUTH_PASSWORD = "secret";
  try {
    const response = proxy(new NextRequest("https://example.com/operations", {
      headers: {
        authorization: `Basic ${Buffer.from("operator:secret").toString("base64")}`,
        "x-request-id": "req-auth-ok"
      }
    }));

    assert.notEqual(response.status, 401);
    assert.equal(response.headers.get("x-request-id"), "req-auth-ok");
  } finally {
    restoreDashboardAuthEnv(originalUser, originalPassword);
  }
});

test("dashboard basic auth exempts signed webhook ingress paths", () => {
  const originalUser = process.env.DASHBOARD_BASIC_AUTH_USERNAME;
  const originalPassword = process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  process.env.DASHBOARD_BASIC_AUTH_USERNAME = "operator";
  process.env.DASHBOARD_BASIC_AUTH_PASSWORD = "secret";
  try {
    const response = proxy(new NextRequest("https://example.com/webhooks/resend/events", {
      headers: { "x-request-id": "req-webhook-auth-bypass" }
    }));

    assert.notEqual(response.status, 401);
    assert.equal(response.headers.get("x-request-id"), "req-webhook-auth-bypass");
  } finally {
    restoreDashboardAuthEnv(originalUser, originalPassword);
  }
});

test("dashboard basic auth fails closed when partially configured", () => {
  const originalUser = process.env.DASHBOARD_BASIC_AUTH_USERNAME;
  const originalPassword = process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  process.env.DASHBOARD_BASIC_AUTH_USERNAME = "operator";
  delete process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  try {
    const response = proxy(new NextRequest("https://example.com/operations", {
      headers: { "x-request-id": "req-auth-misconfigured" }
    }));

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-request-id"), "req-auth-misconfigured");
  } finally {
    restoreDashboardAuthEnv(originalUser, originalPassword);
  }
});

test("dashboard logs inside request context include request id", async () => {
  const captured: string[] = [];
  const logger = createDashboardLogger({
    write(chunk: string) {
      captured.push(chunk);
    }
  });
  const request = new Request("https://example.com/api/commands", {
    headers: {
      "x-request-id": "req-t011-log"
    }
  });

  await runWithRequestContext(request, () => {
    logger.error({ event: "request_context_log" });
  });

  assert.equal(captured.length, 1);
  const parsed = JSON.parse(captured[0]!);
  assert.equal(parsed.event, "request_context_log");
  assert.equal(parsed.requestId, "req-t011-log");
});

test("request context writes request id onto direct route responses", async () => {
  const request = new Request("https://example.com/api/commands", {
    headers: {
      "x-request-id": "req-t011-response"
    }
  });

  const response = await runWithRequestContext(request, () => Response.json({ ok: true }));

  assert.equal(response.headers.get("x-request-id"), "req-t011-response");
});

function restoreDashboardAuthEnv(username: string | undefined, password: string | undefined) {
  if (username === undefined) {
    delete process.env.DASHBOARD_BASIC_AUTH_USERNAME;
  } else {
    process.env.DASHBOARD_BASIC_AUTH_USERNAME = username;
  }
  if (password === undefined) {
    delete process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  } else {
    process.env.DASHBOARD_BASIC_AUTH_PASSWORD = password;
  }
}
