import { embed, embedMany } from 'ai';

import { LOGOS_EMBEDDING_DIMENSIONS } from '@/lib/constants';
import { l2Normalize } from '@/lib/vector';
import { embeddingModel } from '@/lib/vertex-provider';

type EmbeddingTaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';

const providerOptions = (taskType: EmbeddingTaskType) => ({
  vertex: {
    taskType,
    outputDimensionality: LOGOS_EMBEDDING_DIMENSIONS,
  },
});

const embedQuery = async (query: string): Promise<number[]> => {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: query,
    providerOptions: providerOptions('RETRIEVAL_QUERY'),
  });

  return l2Normalize(embedding);
};

const embedDocuments = async (documents: string[]): Promise<number[][]> => {
  if (documents.length === 0) return [];

  const { embeddings } = await embedMany({
    model: embeddingModel(),
    values: documents,
    maxParallelCalls: 2,
    providerOptions: providerOptions('RETRIEVAL_DOCUMENT'),
  });

  return embeddings.map((embedding, index) => l2Normalize(embedding, `embedding[${index}]`));
};

const embeddingService = {
  embedQuery,
  embedDocuments,
};

export default embeddingService;
