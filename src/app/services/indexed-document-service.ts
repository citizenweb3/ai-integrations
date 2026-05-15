import { sql } from 'drizzle-orm';

import db from '@/db';
import { logosChunks, logosSources, type NewLogosChunk, type NewLogosSource } from '@/db/schema';
import { validateEmbedding } from '@/lib/vector';

export type IndexedDocumentInput = NewLogosSource & {
  chunks: Omit<NewLogosChunk, 'sourceId'>[];
};

const validateChunkEmbeddings = (chunks: Pick<NewLogosChunk, 'embedding'>[]): void => {
  for (const [index, chunk] of chunks.entries()) {
    const embedding = chunk.embedding;
    if (embedding === undefined || embedding === null) continue;
    if (!Array.isArray(embedding)) {
      throw new Error(`chunks[${index}].embedding must be a number array`);
    }
    validateEmbedding(embedding, `chunks[${index}].embedding`);
  }
};

const upsertWithChunks = async (input: IndexedDocumentInput): Promise<number> => {
  validateChunkEmbeddings(input.chunks);
  const indexedAt = new Date();

  const [source] = await db.transaction(async (tx) => {
    const [upsertedSource] = await tx
      .insert(logosSources)
      .values({
        sourceType: input.sourceType,
        identifier: input.identifier,
        title: input.title,
        url: input.url,
        contentHash: input.contentHash ?? null,
        remoteRevision: input.remoteRevision ?? null,
        lastFetchedAt: input.lastFetchedAt ?? indexedAt,
        lastIndexedAt: indexedAt,
        fetchError: null,
        metadata: input.metadata ?? null,
        updatedAt: indexedAt,
      })
      .onConflictDoUpdate({
        target: logosSources.identifier,
        set: {
          sourceType: input.sourceType,
          title: input.title,
          url: input.url,
          contentHash: input.contentHash ?? null,
          remoteRevision: input.remoteRevision ?? null,
          lastFetchedAt: input.lastFetchedAt ?? indexedAt,
          lastIndexedAt: indexedAt,
          fetchError: null,
          metadata: input.metadata ?? null,
          updatedAt: indexedAt,
        },
      })
      .returning();

    await tx.delete(logosChunks).where(sql`${logosChunks.sourceId} = ${upsertedSource.id}`);

    if (input.chunks.length > 0) {
      await tx.insert(logosChunks).values(input.chunks.map((chunk) => ({ ...chunk, sourceId: upsertedSource.id })));
    }

    return [upsertedSource];
  });

  return source.id;
};

const indexedDocumentService = {
  upsertWithChunks,
};

export default indexedDocumentService;
