import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, streamText } from 'ai';
import type { UIMessage } from 'ai';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import rateLimitService from '@/app/services/rate-limit-service';
import type { RerankedChunk } from '@/app/services/rerank-service';
import type chatLogServiceType from '@/app/services/chat-log-service';
import type retrievalServiceType from '@/app/services/retrieval-service';
import { fallbackAnswer } from '@/lib/chat/fallback-answer';
import { hasVertexConfig, modelConfig } from '@/lib/model-config';
import { buildSystemPrompt } from '@/lib/prompts/system-prompt';
import { hashIp, sanitizeUserText } from '@/lib/security';
import { answerLanguageModel } from '@/lib/vertex-provider';

export const maxDuration = 60;

type ChatSource = {
  id: number;
  citationId: number;
  title: string;
  url: string;
  sourceType: string;
  snippet: string;
};

type ChatMessageMetadata = {
  sources: ChatSource[];
};

type ChatUIMessage = UIMessage<ChatMessageMetadata>;
type ChatLogService = typeof chatLogServiceType;
type RetrievalService = typeof retrievalServiceType;

const chatRequestSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  messages: z.array(z.custom<ChatUIMessage>()).min(1).max(24),
});

const extractText = (message: ChatUIMessage): string => {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
    .trim();
};

const clientIp = (request: NextRequest): string => {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
};

const sourcesForChunks = (chunks: RerankedChunk[]): ChatSource[] => {
  return chunks.map((chunk, index) => ({
    id: chunk.id,
    citationId: index + 1,
    title: chunk.sourceTitle,
    url: chunk.sourceUrl,
    sourceType: chunk.sourceType,
    snippet: chunk.content.slice(0, 240),
  }));
};

const sourcesForLog = (sources: ChatSource[]) => {
  return sources.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    sourceType: source.sourceType,
    snippet: source.snippet,
  }));
};

const loadServices = async (): Promise<{
  chatLogService: ChatLogService;
  retrievalService: RetrievalService;
}> => {
  const [chatLogModule, retrievalModule] = await Promise.all([
    import('@/app/services/chat-log-service'),
    import('@/app/services/retrieval-service'),
  ]);

  return {
    chatLogService: chatLogModule.default,
    retrievalService: retrievalModule.default,
  };
};

const sanitizeMessages = (messages: ChatUIMessage[]): ChatUIMessage[] => {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-12)
    .map((message) => ({
      ...message,
      parts:
        message.role === 'user'
          ? message.parts.map((part) =>
              part.type === 'text' ? { ...part, text: sanitizeUserText(part.text) } : part,
            )
          : message.parts,
    }));
};

const createMockResponse = async (input: {
  chatLogService: ChatLogService;
  query: string;
  sessionId: string;
  ipHash: string;
  rewritten: string;
  chunks: RerankedChunk[];
  sources: ChatSource[];
  startedAt: number;
  retrievalLatencyMs: number;
}): Promise<Response> => {
  const answer = fallbackAnswer(input.query, input.chunks);
  await input.chatLogService.record({
    sessionId: input.sessionId,
    ipHash: input.ipHash,
    query: input.query,
    rewrittenQuery: input.rewritten,
    retrievedIds: input.chunks.map((chunk) => chunk.id),
    answer,
    sourcesJson: sourcesForLog(input.sources),
    latencyMs: Date.now() - input.startedAt,
    retrievalLatencyMs: input.retrievalLatencyMs,
    generationLatencyMs: 0,
    model: 'mock-chat',
    finishReason: 'stop',
  });

  const stream = createUIMessageStream<ChatUIMessage>({
    execute({ writer }) {
      writer.write({ type: 'start' });
      writer.write({ type: 'text-start', id: 'answer' });

      for (const token of answer.split(/(\s+)/)) {
        if (!token) continue;
        writer.write({ type: 'text-delta', id: 'answer', delta: token });
      }

      writer.write({ type: 'text-end', id: 'answer' });
      writer.write({ type: 'finish', finishReason: 'stop', messageMetadata: { sources: input.sources } });
    },
  });

  return createUIMessageStreamResponse({ stream });
};

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const ip = clientIp(request);
  const ipHash = hashIp(ip);

  let sessionId = 'unknown';
  let query = '';
  let chatLogService: ChatLogService | null = null;

  try {
    const body = chatRequestSchema.parse(await request.json());
    sessionId = body.sessionId ?? body.id ?? crypto.randomUUID();

    const messages = sanitizeMessages(body.messages);
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    query = lastUserMessage ? sanitizeUserText(extractText(lastUserMessage)) : '';

    if (!query) {
      return Response.json({ error: 'A user text message is required.' }, { status: 400 });
    }

    if (query.length > 4_000) {
      return Response.json({ error: 'Message is too long.' }, { status: 400 });
    }

    const limit = await rateLimitService.check(ipHash, {
      max: Number(process.env.RATE_LIMIT_PER_IP_PER_MINUTE ?? 20),
      windowSec: 60,
    });

    if (!limit.allowed) {
      return Response.json(
        { error: 'Too many requests.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(limit.resetSec),
            'X-RateLimit-Remaining': String(limit.remaining),
          },
        },
      );
    }

    const services = await loadServices();
    chatLogService = services.chatLogService;
    const activeChatLogService = services.chatLogService;

    const retrieval = await services.retrievalService.search(query);
    const sources = sourcesForChunks(retrieval.chunks);

    if (!hasVertexConfig()) {
      return createMockResponse({
        chatLogService: activeChatLogService,
        query,
        sessionId,
        ipHash,
        rewritten: retrieval.rewritten,
        chunks: retrieval.chunks,
        sources,
        startedAt,
        retrievalLatencyMs: retrieval.retrievalLatencyMs,
      });
    }

    const generationStartedAt = Date.now();
    const modelMessages = await convertToModelMessages(
      messages.map((message) => ({
        role: message.role,
        metadata: message.metadata,
        parts: message.parts,
      })),
    );
    let logged = false;

    const logOnce = async (input: {
      answer: string;
      finishReason?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      errorCode?: string;
      errorMessage?: string;
    }) => {
      if (logged) return;
      logged = true;

      await activeChatLogService.record({
        sessionId,
        ipHash,
        query,
        rewrittenQuery: retrieval.rewritten,
        retrievedIds: retrieval.chunks.map((chunk) => chunk.id),
        answer: input.answer,
        sourcesJson: sourcesForLog(sources),
        latencyMs: Date.now() - startedAt,
        retrievalLatencyMs: retrieval.retrievalLatencyMs,
        generationLatencyMs: Date.now() - generationStartedAt,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        finishReason: input.finishReason,
        model: modelConfig.answerModel,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      });
    };

    const result = streamText({
      model: answerLanguageModel(),
      system: buildSystemPrompt(retrieval.chunks),
      messages: modelMessages,
      temperature: 0.2,
      onFinish: async (event) => {
        await logOnce({
          answer: event.text,
          finishReason: event.finishReason,
          promptTokens: event.totalUsage.inputTokens,
          completionTokens: event.totalUsage.outputTokens,
          totalTokens: event.totalUsage.totalTokens,
        }).catch((error) => {
          console.error('[chat] failed to record chat log', error);
        });
      },
      onError: async ({ error }) => {
        await logOnce({
          answer: '',
          errorCode: 'generation_error',
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch((logError) => {
          console.error('[chat] failed to record chat error log', logError);
        });
      },
    });

    return result.toUIMessageStreamResponse<ChatUIMessage>({
      originalMessages: messages,
      messageMetadata: ({ part }) => (part.type === 'finish' ? { sources } : undefined),
      onError: (error) => {
        console.error('[chat] stream error', error);
        return 'The answer stream failed.';
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (chatLogService) {
      await chatLogService
        .record({
          sessionId,
          ipHash,
          query: query || '[unparsed]',
          retrievedIds: [],
          answer: '',
          latencyMs: Date.now() - startedAt,
          model: modelConfig.answerModel,
          errorCode: 'chat_route_error',
          errorMessage: message,
        })
        .catch(() => undefined);
    }

    return Response.json({ error: 'Chat request failed.' }, { status: 500 });
  }
}
