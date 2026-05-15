import { and, eq, inArray, like, not, sql } from 'drizzle-orm';

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

const markFetchErrorByIdentifier = async (
  identifier: string,
  input: Pick<NewLogosSource, 'sourceType' | 'title' | 'url'> & { error: string },
): Promise<void> => {
  await db
    .insert(logosSources)
    .values({
      sourceType: input.sourceType,
      identifier,
      title: input.title,
      url: input.url,
      fetchError: input.error,
      lastFetchedAt: now(),
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: logosSources.identifier,
      set: {
        fetchError: input.error,
        lastFetchedAt: now(),
        updatedAt: now(),
      },
    });
};

const countChunks = async (id: number): Promise<number> => {
  const [row] = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM logos_chunks WHERE source_id = ${id}`,
  );

  return Number(row?.count ?? 0);
};

const deleteByIdentifiers = async (identifiers: string[]): Promise<void> => {
  if (identifiers.length === 0) return;
  await db.delete(logosSources).where(inArray(logosSources.identifier, identifiers));
};

const deleteByIdentifierPrefixExcept = async (prefix: string, identifiers: string[]): Promise<void> => {
  if (identifiers.length === 0) return;
  await db
    .delete(logosSources)
    .where(and(like(logosSources.identifier, `${prefix}%`), not(inArray(logosSources.identifier, identifiers))));
};

const sourceService = {
  list,
  findById,
  findByIdentifier,
  upsert,
  markFetched,
  markFetchErrorByIdentifier,
  countChunks,
  deleteByIdentifiers,
  deleteByIdentifierPrefixExcept,
};

export default sourceService;
