export type ResendSendInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  headers?: Record<string, string>;
};

export type ResendSendResult =
  | { kind: "sent"; providerMessageId: string }
  | { kind: "ambiguous"; reason: string }
  | { kind: "failed"; reason: string; retryable: boolean };

export type ResendClient = {
  send(input: ResendSendInput): Promise<ResendSendResult>;
};

type ResendClientOptions = {
  apiKey: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
};

export function createResendClient(options: ResendClientOptions): ResendClient {
  const apiUrl = options.apiUrl ?? "https://api.resend.com/emails";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(input) {
      let response: Response;
      try {
        response = await fetchImpl(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
            "Idempotency-Key": input.idempotencyKey
          },
          body: JSON.stringify({
            from: input.from,
            to: input.to,
            subject: input.subject,
            text: input.text,
            ...(input.headers && Object.keys(input.headers).length > 0
              ? { headers: input.headers }
              : {})
          })
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "ambiguous", reason: `Network error: ${message}` };
      }

      if (response.status >= 200 && response.status < 300) {
        const data = await safeJson(response);
        const providerMessageId = typeof data?.id === "string" ? data.id : undefined;
        if (!providerMessageId) {
          return { kind: "ambiguous", reason: "Resend 2xx without message id" };
        }
        return { kind: "sent", providerMessageId };
      }

      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        const text = await safeText(response);
        return { kind: "ambiguous", reason: `Resend ${response.status}: ${text}` };
      }

      const text = await safeText(response);
      return { kind: "failed", reason: `Resend ${response.status}: ${text}`, retryable: false };
    }
  };
}

async function safeJson(response: Response): Promise<{ id?: unknown } | null> {
  try {
    return (await response.json()) as { id?: unknown };
  } catch {
    return null;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}
