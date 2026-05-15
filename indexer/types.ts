export type FetchedDocument = {
  identifier: string;
  sourceType: string;
  title: string;
  url: string;
  content: string;
  sectionPath?: string;
  remoteRevision?: string;
  language?: string;
  metadata?: Record<string, unknown>;
};

export type DocumentChunk = {
  chunkIndex: number;
  sectionPath: string | null;
  content: string;
  contextPrefix: string | null;
  contentForEmbed: string;
  tokenCount: number;
  language: string | null;
};

export type EmbeddedDocumentChunk = DocumentChunk & {
  embedding: number[];
};

export type IndexerSource = {
  id: string;
  title: string;
  schedule: string;
  enabled: boolean;
  fetch: () => Promise<FetchedDocument[]>;
  pruneIdentifierPrefix?: string;
  errorRecord?: Pick<FetchedDocument, 'identifier' | 'sourceType' | 'title' | 'url'>;
};

export type SourceJobResult = {
  sourceId: string;
  documents: number;
  chunks: number;
  skipped: number;
  failed: number;
};
