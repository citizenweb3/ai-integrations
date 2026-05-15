import embeddingService from '../../src/app/services/embedding-service';
import { hasVertexConfig, modelConfig } from '../../src/lib/model-config';
import { mockEmbedding } from '../../src/lib/vector';

const shouldUseMockEmbeddings = (): boolean => process.env.INDEXER_MOCK_EMBEDDINGS === '1';

export const indexerEmbeddingModel = (): string => {
  return shouldUseMockEmbeddings() ? 'mock-embedding-768' : modelConfig.embeddingModel;
};

export const embedForIndexer = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) return [];

  if (shouldUseMockEmbeddings()) {
    return texts.map((text) => mockEmbedding(text));
  }

  if (!hasVertexConfig()) {
    throw new Error('Google Vertex project/location is required unless INDEXER_MOCK_EMBEDDINGS=1');
  }

  return embeddingService.embedDocuments(texts);
};
