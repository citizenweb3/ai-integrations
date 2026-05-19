import { applyWorkItemActionCommand } from "@bizdev/db";
import { workItemActionRequestSchema } from "@bizdev/shared";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json()
    : formDataToWorkItemAction(await request.formData());

  const parsed = workItemActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await applyWorkItemActionCommand({
      workItemId: parsed.data.workItemId,
      action: parsed.data.action,
      ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
      ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}),
      ...(parsed.data.snoozeMinutes ? { snoozeMinutes: parsed.data.snoozeMinutes } : {})
    });
    if (contentType.includes("application/json")) {
      return NextResponse.json({
        commandId: result.command?.id ?? null,
        workItemId: result.workItem?.id ?? parsed.data.workItemId,
        status: result.workItem?.status ?? null,
        deduplicated: result.deduplicated
      });
    }

    return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (contentType.includes("application/json")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const base = safeRedirectUrl(request);
    base.searchParams.set("error", message);
    return NextResponse.redirect(base, { status: 303 });
  }
}

function safeRedirectUrl(request: Request): URL {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const browserOrigin = host ? `${proto}://${host}` : new URL(request.url).origin;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const candidate = new URL(referer);
      if (candidate.host === host) {
        return candidate;
      }
    } catch {
      // fall through
    }
  }
  return new URL("/", browserOrigin);
}

function formDataToWorkItemAction(formData: FormData) {
  const snoozeMinutes = String(formData.get("snoozeMinutes") ?? "").trim();
  const actorId = String(formData.get("actorId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  return {
    workItemId: String(formData.get("workItemId") ?? ""),
    action: String(formData.get("action") ?? ""),
    ...(actorId ? { actorId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(snoozeMinutes ? { snoozeMinutes } : {})
  };
}
