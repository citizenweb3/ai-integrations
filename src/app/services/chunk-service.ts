import { eq, inArray, sql } from 'drizzle-orm';

import db from '@/db';
import { logosChunks, logosSources, type LogosChunk, type NewLogosChunk } from '@/db/schema';
import { toPgVector, validateEmbedding } from '@/lib/vector';

export type ChunkWithSource = LogosChunk & {
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
};

export type HybridSearchResult = {
  id: number;
  sourceId: number;
  chunkIndex: number;
  sectionPath: string | null;
  content: string;
  contextPrefix: string | null;
  language: string | null;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
  rrfScore: number;
};

const validateChunkEmbeddings = (chunks: Pick<NewLogosChunk, 'embedding'>[], label: string): void => {
  for (const [index, chunk] of chunks.entries()) {
    const embedding = chunk.embedding;
    if (embedding === undefined || embedding === null) continue;
    if (!Array.isArray(embedding)) {
      throw new Error(`${label}[${index}].embedding must be a number array`);
    }
    validateEmbedding(embedding, `${label}[${index}].embedding`);
  }
};

const insertMany = async (chunks: NewLogosChunk[]): Promise<LogosChunk[]> => {
  if (chunks.length === 0) return [];
  validateChunkEmbeddings(chunks, 'chunks');
  return db.insert(logosChunks).values(chunks).returning();
};

const replaceForSource = async (sourceId: number, chunks: Omit<NewLogosChunk, 'sourceId'>[]): Promise<void> => {
  validateChunkEmbeddings(chunks, 'chunks');

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

const countBySourceAndEmbeddingModel = async (sourceId: number, embeddingModel: string): Promise<number> => {
  const [row] = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM logos_chunks WHERE source_id = ${sourceId} AND embedding_model = ${embeddingModel}`,
  );

  return Number(row?.count ?? 0);
};

const hybridSearch = async (
  queryText: string,
  queryEmbedding: number[],
  limit = 40,
  embeddingModel?: string,
): Promise<HybridSearchResult[]> => {
  validateEmbedding(queryEmbedding, 'queryEmbedding');
  const vector = toPgVector(queryEmbedding);

  const rows = await db.execute<{
    id: number;
    source_id: number;
    chunk_index: number;
    section_path: string | null;
    content: string;
    context_prefix: string | null;
    language: string | null;
    source_title: string;
    source_url: string;
    source_type: string;
    rrf_score: string | number;
  }>(sql`
    WITH vector_hits AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vector}::vector(768)) AS rank
      FROM logos_chunks
      WHERE embedding IS NOT NULL
        AND (${embeddingModel ?? null}::text IS NULL OR embedding_model = ${embeddingModel ?? null})
      ORDER BY embedding <=> ${vector}::vector(768)
      LIMIT 40
    ),
    bm25_hits AS (
      SELECT id, ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(content_tsv, plainto_tsquery('english', ${queryText})) DESC
      ) AS rank
	      FROM logos_chunks
	      WHERE content_tsv @@ plainto_tsquery('english', ${queryText})
	        AND (${embeddingModel ?? null}::text IS NULL OR embedding_model = ${embeddingModel ?? null})
	      ORDER BY ts_rank_cd(content_tsv, plainto_tsquery('english', ${queryText})) DESC
	      LIMIT 40
    ),
    fused AS (
      SELECT id, SUM(1.0 / (60 + rank)) AS rrf_score
      FROM (
        SELECT * FROM vector_hits
        UNION ALL
        SELECT * FROM bm25_hits
      ) candidates
      GROUP BY id
      ORDER BY rrf_score DESC
      LIMIT ${limit}
    )
    SELECT
      lc.id,
      lc.source_id,
      lc.chunk_index,
      lc.section_path,
      lc.content,
      lc.context_prefix,
      lc.language,
      ls.title AS source_title,
      ls.url AS source_url,
      ls.source_type,
      fused.rrf_score
    FROM fused
    JOIN logos_chunks lc ON lc.id = fused.id
    JOIN logos_sources ls ON ls.id = lc.source_id
    ORDER BY fused.rrf_score DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    sectionPath: row.section_path,
    content: row.content,
    contextPrefix: row.context_prefix,
    language: row.language,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    rrfScore: Number(row.rrf_score),
  }));
};

const chunkService = {
  insertMany,
  replaceForSource,
  deleteBySource,
  findByIds,
  countBySource,
  countBySourceAndEmbeddingModel,
  hybridSearch,
};

export default chunkService;
