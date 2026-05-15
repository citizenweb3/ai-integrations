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

export type RetrievalResult = {
  query: string;
  rewritten: string;
  chunks: RerankedChunk[];
  retrievalLatencyMs: number;
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

const search = async (query: string, options: SearchOptions = {}): Promise<RetrievalResult> => {
  const startedAt = Date.now();
  const rewritten = await rewriteQuery(query, options.skipRewrite);
  const mockRetrievalEmbeddings = shouldUseMockRetrievalEmbeddings();
  const hasExplicitQueryEmbedding = options.queryEmbedding !== undefined;
  const queryEmbedding =
    options.queryEmbedding ?? (mockRetrievalEmbeddings ? mockEmbedding(rewritten) : await embeddingService.embedQuery(rewritten));
  const embeddingModel =
    options.embeddingModel ??
    (hasExplicitQueryEmbedding ? modelConfig.embeddingModel : mockRetrievalEmbeddings ? 'mock-embedding-768' : modelConfig.embeddingModel);
  const candidates = await chunkService.hybridSearch(rewritten, queryEmbedding, 40, embeddingModel);
  const finalK = options.finalK ?? 8;
  const chunks = options.skipRerank
    ? candidates.slice(0, finalK).map((candidate, index) => ({
        ...candidate,
        rerankScore: Math.max(0, 10 - index),
      }))
    : await rerankService.rerank(rewritten, candidates, finalK);

  return {
    query,
    rewritten,
    chunks,
    retrievalLatencyMs: Date.now() - startedAt,
  };
};

const retrievalService = {
  search,
};

export default retrievalService;
