import { eq, sql } from 'drizzle-orm';

import db from '@/db';
import { logosSources, type LogosSource, type NewLogosSource } from '@/db/schema';

type UpsertSourceInput = NewLogosSource;

const now = () => new Date();

const list = async (): Promise<LogosSource[]> => {
  return db.select().from(logosSources).orderBy(logosSources.sourceType, logosSources.title);
};

const findById = async (id: number): Promise<LogosSource | null> => {
  const [source] = await db.select().from(logosSources).where(eq(logosSources.id, id)).limit(1);
  return source ?? null;
};

const findByIdentifier = async (identifier: string): Promise<LogosSource | null> => {
  const [source] = await db
    .select()
    .from(logosSources)
    .where(eq(logosSources.identifier, identifier))
    .limit(1);
  return source ?? null;
};

const upsert = async (input: UpsertSourceInput): Promise<LogosSource> => {
  const [source] = await db
    .insert(logosSources)
    .values({
      ...input,
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: logosSources.identifier,
      set: {
        sourceType: input.sourceType,
        title: input.title,
        url: input.url,
        contentHash: input.contentHash ?? null,
        remoteRevision: input.remoteRevision ?? null,
        lastFetchedAt: input.lastFetchedAt ?? null,
        lastIndexedAt: input.lastIndexedAt ?? null,
        fetchError: input.fetchError ?? null,
        metadata: input.metadata ?? null,
        updatedAt: now(),
      },
    })
    .returning();

  return source;
};

const markFetched = async (
  id: number,
  input: Pick<NewLogosSource, 'contentHash' | 'remoteRevision' | 'lastFetchedAt' | 'fetchError'>,
): Promise<void> => {
  await db
    .update(logosSources)
    .set({
      contentHash: input.contentHash ?? null,
      remoteRevision: input.remoteRevision ?? null,
      lastFetchedAt: input.lastFetchedAt ?? now(),
      fetchError: input.fetchError ?? null,
      updatedAt: now(),
    })
    .where(eq(logosSources.id, id));
};

const countChunks = async (id: number): Promise<number> => {
  const [row] = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM logos_chunks WHERE source_id = ${id}`,
  );

  return Number(row?.count ?? 0);
};

const sourceService = {
  list,
  findById,
  findByIdentifier,
  upsert,
  markFetched,
  countChunks,
};

export default sourceService;
