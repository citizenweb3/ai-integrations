import chunkService from '../../src/app/services/chunk-service';
import sourceService from '../../src/app/services/source-service';
import { indexerEmbeddingModel, embedForIndexer } from '../pipeline/embedder';
import { chunkDocument } from '../pipeline/chunker';
import { hashFetchedDocument } from '../pipeline/document-hash';
import { upsertIndexedDocument } from '../pipeline/upsert';
import type { IndexerSource, SourceJobResult } from '../types';

const MAX_CHUNKS_PER_SOURCE = 30;

export const runSourceJob = async (source: IndexerSource): Promise<SourceJobResult> => {
  const documents = await source.fetch();
  const embeddingModel = indexerEmbeddingModel();
  let chunkCount = 0;
  let skipped = 0;
  let failed = 0;

  for (const document of documents) {
    try {
      const chunks = chunkDocument(document);
      const cappedChunks =
        chunks.length > MAX_CHUNKS_PER_SOURCE
          ? [...chunks]
              .sort((a, b) => b.tokenCount - a.tokenCount)
              .slice(0, MAX_CHUNKS_PER_SOURCE)
              .sort((a, b) => a.chunkIndex - b.chunkIndex)
          : chunks;
      const contentHash = hashFetchedDocument(document);
      const existingSource = await sourceService.findByIdentifier(document.identifier);
      const matchingChunkCount = existingSource
        ? await chunkService.countBySourceAndEmbeddingModel(existingSource.id, embeddingModel)
        : 0;

      if (
        existingSource?.contentHash === contentHash &&
        existingSource.remoteRevision === (document.remoteRevision ?? null) &&
        matchingChunkCount === cappedChunks.length
      ) {
        await sourceService.markFetched(existingSource.id, {
          contentHash,
          remoteRevision: document.remoteRevision ?? null,
          lastFetchedAt: new Date(),
          fetchError: null,
        });
        skipped += 1;
        continue;
      }

      const embeddings = await embedForIndexer(cappedChunks.map((chunk) => chunk.contentForEmbed));
      chunkCount += await upsertIndexedDocument(document, cappedChunks, embeddings, embeddingModel);
    } catch (error) {
      failed += 1;
      await sourceService.markFetchErrorByIdentifier(document.identifier, {
        sourceType: document.sourceType,
        title: document.title,
        url: document.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (source.pruneIdentifierPrefix && documents.length > 0 && failed === 0) {
    await sourceService.deleteByIdentifierPrefixExcept(
      source.pruneIdentifierPrefix,
      documents.map((document) => document.identifier),
    );
  }

  return {
    sourceId: source.id,
    documents: documents.length,
    chunks: chunkCount,
    skipped,
    failed,
  };
};
