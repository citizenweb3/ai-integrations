export const REQUEST_ID_HEADER = "x-request-id";

export function normalizeRequestId(value: string | null): string | null {
  const requestId = value?.trim();
  return requestId || null;
}
