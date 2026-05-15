import { generateText } from 'ai';

import chunkService from '@/app/services/chunk-service';
import embeddingService from '@/app/services/embedding-service';
import rerankService, { type RerankedChunk } from '@/app/services/rerank-service';
import retrievalCacheService from '@/app/services/retrieval-cache-service';
import { hasVertexConfig, modelConfig } from '@/lib/model-config';
import { mockEmbedding } from '@/lib/vector';
import { rewriteLanguageModel } from '@/lib/vertex-provider';

type SearchOptions = {
  queryEmbedding?: number[];
  embeddingModel?: string;
  skipRewrite?: boolean;
  skipRerank?: boolean;
  finalK?: number;
  history?: string;
};

export type RetrievalStepTimings = {
  rewriteMs: number;
  embedMs: number;
  searchMs: number;
  rerankMs: number;
  rewriteCacheHit: boolean;
  embedCacheHit: boolean;
};

export type RetrievalResult = {
  query: string;
  rewritten: string;
  chunks: RerankedChunk[];
  retrievalLatencyMs: number;
  stepTimings: RetrievalStepTimings;
};

type RewriteOutcome = { rewritten: string; cacheHit: boolean };

const buildRewritePrompt = (query: string, history?: string): string => {
  if (!history) {
    return `Rewrite this user question as a concise technical search query for Logos documentation. Return only the query.\n\n${query}`;
  }
  return `Rewrite the user's latest question as a standalone, concise technical search query for Logos documentation. Use the prior conversation to resolve pronouns and implicit references ("that", "it", "more about it"). Return only the rewritten query, no explanations.\n\nConversation so far:\n${history}\n\nLatest question: ${query}`;
};

const rewriteQuery = async (
  query: string,
  history?: string,
  skipRewrite?: boolean,
): Promise<RewriteOutcome> => {
  if (skipRewrite || !hasVertexConfig()) return { rewritten: query, cacheHit: false };

  const hasHistory = Boolean(history);

  if (!hasHistory) {
    const cached = await retrievalCacheService.getRewrite(query);
    if (cached) return { rewritten: cached, cacheHit: true };
  }

  try {
    const result = await generateText({
      model: rewriteLanguageModel(),
      temperature: 0,
      prompt: buildRewritePrompt(query, history),
    });

    const rewritten = result.text.trim() || query;
    if (!hasHistory) {
      void retrievalCacheService.setRewrite(query, rewritten);
    }
    return { rewritten, cacheHit: false };
  } catch (error) {
    console.warn('[retrieval] query rewrite failed; using original query', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { rewritten: query, cacheHit: false };
  }
};

const shouldUseMockRetrievalEmbeddings = (): boolean => process.env.RETRIEVAL_MOCK_EMBEDDINGS === '1';

const RERANK_ENABLED_DEFAULT = true;

const search = async (query: string, options: SearchOptions = {}): Promise<RetrievalResult> => {
  const startedAt = Date.now();

  const rewriteStartedAt = Date.now();
  const { rewritten, cacheHit: rewriteCacheHit } = await rewriteQuery(query, options.history, options.skipRewrite);
  const rewriteMs = Date.now() - rewriteStartedAt;

  const mockRetrievalEmbeddings = shouldUseMockRetrievalEmbeddings();
  const hasExplicitQueryEmbedding = options.queryEmbedding !== undefined;
  const resolvedEmbeddingModel = mockRetrievalEmbeddings ? 'mock-embedding-768' : modelConfig.embeddingModel;

  const embedStartedAt = Date.now();
  let embedCacheHit = false;
  let queryEmbedding: number[];
  if (options.queryEmbedding) {
    queryEmbedding = options.queryEmbedding;
  } else if (mockRetrievalEmbeddings) {
    queryEmbedding = mockEmbedding(rewritten);
  } else {
    const cachedEmbedding = await retrievalCacheService.getEmbedding(rewritten, resolvedEmbeddingModel);
    if (cachedEmbedding) {
      queryEmbedding = cachedEmbedding;
      embedCacheHit = true;
    } else {
      queryEmbedding = await embeddingService.embedQuery(rewritten);
      void retrievalCacheService.setEmbedding(rewritten, resolvedEmbeddingModel, queryEmbedding);
    }
  }
  const embedMs = hasExplicitQueryEmbedding ? 0 : Date.now() - embedStartedAt;

  const embeddingModel = options.embeddingModel ?? resolvedEmbeddingModel;

  const searchStartedAt = Date.now();
  const candidates = await chunkService.hybridSearch(rewritten, queryEmbedding, 40, embeddingModel);
  const searchMs = Date.now() - searchStartedAt;

  const finalK = options.finalK ?? 8;
  const rerankEnabled =
    options.skipRerank !== undefined ? !options.skipRerank : RERANK_ENABLED_DEFAULT;
  const rerankStartedAt = Date.now();
  const chunks = rerankEnabled
    ? await rerankService.rerank(rewritten, candidates, finalK)
    : candidates.slice(0, finalK).map((candidate, index) => ({
        ...candidate,
        rerankScore: Math.max(0, 10 - index),
      }));
  const rerankMs = rerankEnabled ? Date.now() - rerankStartedAt : 0;

  const retrievalLatencyMs = Date.now() - startedAt;
  const stepTimings: RetrievalStepTimings = {
    rewriteMs,
    embedMs,
    searchMs,
    rerankMs,
    rewriteCacheHit,
    embedCacheHit,
  };

  console.info(
    JSON.stringify({
      event: 'retrieval_timing',
      query,
      rewritten,
      candidates: candidates.length,
      finalChunks: chunks.length,
      retrievalLatencyMs,
      ...stepTimings,
    }),
  );

  return {
    query,
    rewritten,
    chunks,
    retrievalLatencyMs,
    stepTimings,
  };
};

const retrievalService = {
  search,
};

export default retrievalService;
