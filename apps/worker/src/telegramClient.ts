// Minimal Telegram Bot API client for outbound notifications.
//
// Auth: a bot token issued by @BotFather. Channel/chat targeting is by
// numeric `chat_id` (groups/channels) or numeric user id. We use the
// `sendMessage` endpoint exclusively in MVP — richer affordances
// (inline keyboards for inline approve/reject) belong to the T3 slice
// where the inbound side of the bridge is wired.
//
// Result kinds mirror the Resend client so the worker dispatch layer can
// treat both providers identically: `sent` → success, `ambiguous` →
// retry (transient network / 5xx / 429), `failed` → non-retryable
// (auth / chat-not-found / 4xx other than rate-limit).

export type TelegramSendInput = {
  chatId: string;
  text: string;
  parseMode?: "MarkdownV2" | "HTML";
  disableWebPagePreview?: boolean;
};

export type TelegramSendResult =
  | { kind: "sent"; providerMessageId: string }
  | { kind: "ambiguous"; reason: string }
  | { kind: "failed"; reason: string; retryable: boolean };

export type TelegramClient = {
  send(input: TelegramSendInput): Promise<TelegramSendResult>;
};

type TelegramClientOptions = {
  botToken: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
};

export function createTelegramClient(options: TelegramClientOptions): TelegramClient {
  const apiUrl = options.apiUrl ?? "https://api.telegram.org";
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${apiUrl}/bot${options.botToken}/sendMessage`;

  return {
    async send(input) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: input.chatId,
            text: input.text,
            ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
            ...(input.disableWebPagePreview
              ? { disable_web_page_preview: true }
              : {})
          })
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "ambiguous", reason: `Network error: ${message}` };
      }

      const data = await safeJson(response);

      if (response.status >= 200 && response.status < 300 && data?.ok === true) {
        const messageId = readMessageId(data.result);
        if (messageId === null) {
          return { kind: "ambiguous", reason: "Telegram 2xx without message_id" };
        }
        return { kind: "sent", providerMessageId: messageId };
      }

      // 5xx + 429 → retry. Telegram surfaces rate limits with `retry_after`
      // in `parameters`; the policy engine handles backoff so we only need
      // to mark it retryable.
      if (response.status >= 500 || response.status === 429) {
        const desc = readDescription(data) ?? `HTTP ${response.status}`;
        return { kind: "ambiguous", reason: `Telegram ${response.status}: ${desc}` };
      }

      const desc = readDescription(data) ?? `HTTP ${response.status}`;
      return { kind: "failed", reason: `Telegram ${response.status}: ${desc}`, retryable: false };
    }
  };
}

async function safeJson(response: Response): Promise<{ ok?: unknown; result?: unknown; description?: unknown } | null> {
  try {
    return (await response.json()) as { ok?: unknown; result?: unknown; description?: unknown };
  } catch {
    return null;
  }
}

function readMessageId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const id = (result as { message_id?: unknown }).message_id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id.length > 0) return id;
  return null;
}

function readDescription(data: { description?: unknown } | null): string | null {
  if (!data) return null;
  return typeof data.description === "string" ? data.description : null;
}

export type TelegramRuntimeConfig = {
  botToken: string;
  defaultChatId: string;
};

export function readTelegramRuntimeConfigFromEnv(): TelegramRuntimeConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const defaultChatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !defaultChatId) return null;
  return { botToken, defaultChatId };
}
