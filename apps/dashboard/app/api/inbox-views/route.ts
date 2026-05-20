import {
  createInboxView,
  deleteInboxView,
  updateInboxView
} from "@bizdev/db";
import { NextResponse } from "next/server";

type InboxViewAction =
  | {
      action: "create";
      operatorId?: string;
      name: string;
      filterJson: Record<string, unknown>;
    }
  | {
      action: "update";
      operatorId?: string;
      viewId: string;
      name: string;
      filterJson: Record<string, unknown>;
    }
  | {
      action: "delete";
      operatorId?: string;
      viewId: string;
    };

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson
    ? await request.json() as InboxViewAction
    : formDataToInboxViewAction(await request.formData());

  try {
    switch (body.action) {
      case "create": {
        const created = await createInboxView({
          name: body.name,
          filterJson: body.filterJson,
          ...(body.operatorId ? { operatorId: body.operatorId } : {})
        });
        if (isJson) {
          return NextResponse.json({ view: created });
        }
        return NextResponse.redirect(inboxRedirectUrl(request, created.id), { status: 303 });
      }

      case "update": {
        const updated = await updateInboxView({
          id: body.viewId,
          name: body.name,
          filterJson: body.filterJson,
          ...(body.operatorId ? { operatorId: body.operatorId } : {})
        });
        if (!updated) {
          return errorResponse(request, isJson, "Inbox view not found", 404);
        }
        if (isJson) {
          return NextResponse.json({ view: updated });
        }
        return NextResponse.redirect(inboxRedirectUrl(request, updated.id), { status: 303 });
      }

      case "delete": {
        const result = await deleteInboxView({
          id: body.viewId,
          ...(body.operatorId ? { operatorId: body.operatorId } : {})
        });
        if (isJson) {
          return NextResponse.json(result);
        }
        return NextResponse.redirect(inboxRedirectUrl(request, null), { status: 303 });
      }
    }
    return errorResponse(request, isJson, "Unsupported inbox view action", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(request, isJson, message, 409);
  }
}

function formDataToInboxViewAction(formData: FormData): InboxViewAction {
  const action = String(formData.get("action") ?? "");
  const operatorId = stringValue(formData, "operatorId");
  const viewId = stringValue(formData, "viewId");
  if (action === "delete" && viewId) {
    return { action, viewId, ...(operatorId ? { operatorId } : {}) };
  }

  const name = stringValue(formData, "name");
  const filterJson = {
    types: stringValue(formData, "types"),
    statuses: stringValue(formData, "statuses"),
    campaignIds: stringValue(formData, "campaignIds"),
    priorityMin: stringValue(formData, "priorityMin"),
    fromEmail: stringValue(formData, "fromEmail")
  };

  if (action === "update" && viewId) {
    return { action, viewId, name, filterJson, ...(operatorId ? { operatorId } : {}) };
  }
  return { action: "create", name, filterJson, ...(operatorId ? { operatorId } : {}) };
}

function stringValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function errorResponse(request: Request, isJson: boolean, message: string, status: number) {
  if (isJson) {
    return NextResponse.json({ error: message }, { status });
  }
  const redirect = safeRedirectUrl(request);
  redirect.searchParams.set("error", message);
  return NextResponse.redirect(redirect, { status: 303 });
}

function inboxRedirectUrl(request: Request, viewId: string | null): URL {
  const url = safeRedirectUrl(request);
  url.pathname = "/inbox";
  url.searchParams.delete("cursor");
  url.searchParams.delete("error");
  if (viewId) {
    url.searchParams.set("view", viewId);
    url.searchParams.delete("tab");
  } else {
    url.searchParams.delete("view");
  }
  return url;
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
  return new URL("/inbox", browserOrigin);
}
