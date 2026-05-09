import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

export const LOGOS_EMBEDDING_DIMENSIONS = 768;

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

export type SourceMetadata = Record<string, unknown>;

export type ChatLogSource = {
  id: number;
  title: string;
  url: string;
  sourceType: string;
  snippet?: string;
};

export const logosSources = pgTable(
  'logos_sources',
  {
    id: serial('id').primaryKey(),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    identifier: text('identifier').notNull().unique(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    contentHash: varchar('content_hash', { length: 64 }),
    remoteRevision: varchar('remote_revision', { length: 128 }),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    fetchError: text('fetch_error'),
    metadata: jsonb('metadata').$type<SourceMetadata>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('logos_sources_type_idx').on(table.sourceType),
    index('logos_sources_fetched_idx').on(table.lastFetchedAt),
  ],
);

export const logosChunks = pgTable(
  'logos_chunks',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => logosSources.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    sectionPath: text('section_path'),
    content: text('content').notNull(),
    contextPrefix: text('context_prefix'),
    contentForEmbed: text('content_for_embed').notNull(),
    contentTsv: tsvector('content_tsv'),
    embedding: vector('embedding', { dimensions: LOGOS_EMBEDDING_DIMENSIONS }),
    embeddingModel: varchar('embedding_model', { length: 64 }),
    tokenCount: integer('token_count'),
    language: varchar('language', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('logos_chunks_source_idx').on(table.sourceId),
    uniqueIndex('logos_chunks_source_chunk_idx').on(table.sourceId, table.chunkIndex),
    index('logos_chunks_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    index('logos_chunks_tsv_idx').using('gin', table.contentTsv),
  ],
);

export const chatLogs = pgTable(
  'chat_logs',
  {
    id: serial('id').primaryKey(),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    ipHash: varchar('ip_hash', { length: 64 }).notNull(),
    query: text('query').notNull(),
    rewrittenQuery: text('rewritten_query'),
    retrievedIds: integer('retrieved_ids').array().notNull(),
    answer: text('answer').notNull(),
    sourcesJson: jsonb('sources_json').$type<ChatLogSource[]>(),
    feedback: varchar('feedback', { length: 8 }),
    feedbackComment: text('feedback_comment'),
    latencyMs: integer('latency_ms').notNull(),
    retrievalLatencyMs: integer('retrieval_latency_ms'),
    generationLatencyMs: integer('generation_latency_ms'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    finishReason: varchar('finish_reason', { length: 64 }),
    model: varchar('model', { length: 64 }).notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chat_logs_session_idx').on(table.sessionId),
    index('chat_logs_created_idx').on(table.createdAt),
    index('chat_logs_feedback_idx').on(table.feedback),
  ],
);

export type LogosSource = typeof logosSources.$inferSelect;
export type NewLogosSource = typeof logosSources.$inferInsert;
export type LogosChunk = typeof logosChunks.$inferSelect;
export type NewLogosChunk = typeof logosChunks.$inferInsert;
export type ChatLog = typeof chatLogs.$inferSelect;
export type NewChatLog = typeof chatLogs.$inferInsert;
