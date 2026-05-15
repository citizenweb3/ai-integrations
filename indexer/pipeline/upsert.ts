import indexedDocumentService from '../../src/app/services/indexed-document-service';
import type { DocumentChunk, FetchedDocument } from '../types';
import { hashFetchedDocument } from './document-hash';

export const upsertIndexedDocument = async (
  document: FetchedDocument,
  chunks: DocumentChunk[],
  embeddings: number[][],
  embeddingModel: string,
): Promise<number> => {
  if (chunks.length !== embeddings.length) {
    throw new Error(`Chunk count (${chunks.length}) does not match embedding count (${embeddings.length})`);
  }

  await indexedDocumentService.upsertWithChunks({
    sourceType: document.sourceType,
    identifier: document.identifier,
    title: document.title,
    url: document.url,
    contentHash: hashFetchedDocument(document),
    remoteRevision: document.remoteRevision ?? null,
    lastFetchedAt: new Date(),
    metadata: {
      ...(document.metadata ?? {}),
      indexedBy: 'logos-chatbot-indexer',
    },
    chunks: chunks.map((chunk, index) => ({
      chunkIndex: chunk.chunkIndex,
      sectionPath: chunk.sectionPath,
      content: chunk.content,
      contextPrefix: chunk.contextPrefix,
      contentForEmbed: chunk.contentForEmbed,
      embedding: embeddings[index],
      embeddingModel,
      tokenCount: chunk.tokenCount,
      language: chunk.language,
    })),
  });

  return chunks.length;
};
