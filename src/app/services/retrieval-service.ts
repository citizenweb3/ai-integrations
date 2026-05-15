import { generateText } from 'ai';

import chunkService from '@/app/services/chunk-service';
import embeddingService from '@/app/services/embedding-service';
import rerankService, { type RerankedChunk } from '@/app/services/rerank-service';
import { hasVertexConfig, modelConfig } from '@/lib/model-config';
import { mockEmbedding } from '@/lib/vector';
import { rewriteLanguageModel } from '@/lib/vertex-provider';

type SearchOptions = {
  queryEmbedding?: number[];
  embeddingModel?: string;
  skipRewrite?: boolean;
  skipRerank?: boolean;
  finalK?: number;
};

export type RetrievalStepTimings = {
  rewriteMs: number;
  embedMs: number;
  searchMs: number;
  rerankMs: number;
};

export type RetrievalResult = {
  query: string;
  rewritten: string;
  chunks: RerankedChunk[];
  retrievalLatencyMs: number;
  stepTimings: RetrievalStepTimings;
};

const rewriteQuery = async (query: string, skipRewrite?: boolean): Promise<string> => {
  if (skipRewrite || !hasVertexConfig()) return query;

  try {
    const result = await generateText({
      model: rewriteLanguageModel(),
      temperature: 0,
      prompt: `Rewrite this user question as a concise technical search query for Logos documentation. Return only the query.\n\n${query}`,
    });

    return result.text.trim() || query;
  } catch (error) {
    console.warn('[retrieval] query rewrite failed; using original query', {
      error: error instanceof Error ? error.message : String(error),
    });
    return query;
  }
};

const shouldUseMockRetrievalEmbeddings = (): boolean => process.env.RETRIEVAL_MOCK_EMBEDDINGS === '1';

const isRerankEnvEnabled = (): boolean => process.env.RERANK_ENABLED === '1';

const search = async (query: string, options: SearchOptions = {}): Promise<RetrievalResult> => {
  const startedAt = Date.now();

  const rewriteStartedAt = Date.now();
  const rewritten = await rewriteQuery(query, options.skipRewrite);
  const rewriteMs = Date.now() - rewriteStartedAt;

  const mockRetrievalEmbeddings = shouldUseMockRetrievalEmbeddings();
  const hasExplicitQueryEmbedding = options.queryEmbedding !== undefined;

  const embedStartedAt = Date.now();
  const queryEmbedding =
    options.queryEmbedding ?? (mockRetrievalEmbeddings ? mockEmbedding(rewritten) : await embeddingService.embedQuery(rewritten));
  const embedMs = hasExplicitQueryEmbedding ? 0 : Date.now() - embedStartedAt;

  const embeddingModel =
    options.embeddingModel ??
    (hasExplicitQueryEmbedding ? modelConfig.embeddingModel : mockRetrievalEmbeddings ? 'mock-embedding-768' : modelConfig.embeddingModel);

  const searchStartedAt = Date.now();
  const candidates = await chunkService.hybridSearch(rewritten, queryEmbedding, 40, embeddingModel);
  const searchMs = Date.now() - searchStartedAt;

  const finalK = options.finalK ?? 8;
  const rerankEnabled =
    options.skipRerank !== undefined ? !options.skipRerank : isRerankEnvEnabled();
  const rerankStartedAt = Date.now();
  const chunks = rerankEnabled
    ? await rerankService.rerank(rewritten, candidates, finalK)
    : candidates.slice(0, finalK).map((candidate, index) => ({
        ...candidate,
        rerankScore: Math.max(0, 10 - index),
      }));
  const rerankMs = rerankEnabled ? Date.now() - rerankStartedAt : 0;

  const retrievalLatencyMs = Date.now() - startedAt;
  const stepTimings: RetrievalStepTimings = { rewriteMs, embedMs, searchMs, rerankMs };

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
