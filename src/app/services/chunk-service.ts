import { eq, inArray, sql } from 'drizzle-orm';

import db from '@/db';
import { logosChunks, logosSources, type LogosChunk, type NewLogosChunk } from '@/db/schema';

export type ChunkWithSource = LogosChunk & {
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
};

const insertMany = async (chunks: NewLogosChunk[]): Promise<LogosChunk[]> => {
  if (chunks.length === 0) return [];
  return db.insert(logosChunks).values(chunks).returning();
};

const replaceForSource = async (sourceId: number, chunks: Omit<NewLogosChunk, 'sourceId'>[]): Promise<void> => {
  await db.transaction(async (tx) => {
    await tx.delete(logosChunks).where(eq(logosChunks.sourceId, sourceId));

    if (chunks.length > 0) {
      await tx.insert(logosChunks).values(chunks.map((chunk) => ({ ...chunk, sourceId })));
    }

    await tx
      .update(logosSources)
      .set({ lastIndexedAt: new Date(), updatedAt: new Date() })
      .where(eq(logosSources.id, sourceId));
  });
};

const deleteBySource = async (sourceId: number): Promise<void> => {
  await db.delete(logosChunks).where(eq(logosChunks.sourceId, sourceId));
};

const findByIds = async (ids: number[]): Promise<ChunkWithSource[]> => {
  if (ids.length === 0) return [];

  return db
    .select({
      id: logosChunks.id,
      sourceId: logosChunks.sourceId,
      chunkIndex: logosChunks.chunkIndex,
      sectionPath: logosChunks.sectionPath,
      content: logosChunks.content,
      contextPrefix: logosChunks.contextPrefix,
      contentForEmbed: logosChunks.contentForEmbed,
      contentTsv: logosChunks.contentTsv,
      embedding: logosChunks.embedding,
      embeddingModel: logosChunks.embeddingModel,
      tokenCount: logosChunks.tokenCount,
      language: logosChunks.language,
      createdAt: logosChunks.createdAt,
      sourceTitle: logosSources.title,
      sourceUrl: logosSources.url,
      sourceType: logosSources.sourceType,
    })
    .from(logosChunks)
    .innerJoin(logosSources, eq(logosChunks.sourceId, logosSources.id))
    .where(inArray(logosChunks.id, ids));
};

const countBySource = async (sourceId: number): Promise<number> => {
  const [row] = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM logos_chunks WHERE source_id = ${sourceId}`,
  );

  return Number(row?.count ?? 0);
};

const chunkService = {
  insertMany,
  replaceForSource,
  deleteBySource,
  findByIds,
  countBySource,
};

export default chunkService;
