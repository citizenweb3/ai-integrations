import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { normalizeRequestId, REQUEST_ID_HEADER } from "./request-id";

const requestIdStorage = new AsyncLocalStorage<string>();

export function getRequestId(): string | undefined {
  return requestIdStorage.getStore();
}

export function resolveRequestId(headers: Headers): string {
  return normalizeRequestId(headers.get(REQUEST_ID_HEADER)) ?? randomUUID();
}

export async function runWithRequestContext<T>(
  request: Request,
  callback: (requestId: string) => Promise<T> | T
): Promise<T> {
  const requestId = resolveRequestId(request.headers);
  return requestIdStorage.run(requestId, async () => {
    const result = await callback(requestId);
    if (result instanceof Response) {
      result.headers.set("X-Request-Id", requestId);
    }
    return result;
  });
}
