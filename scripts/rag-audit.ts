import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';

type CorpusRow = {
  source_type: string;
  sources: string;
  chunks: string;
  words: string | null;
};

type EmbeddingRow = {
  embedding_model: string | null;
  chunks: string;
  min_words: number | null;
  median_words: string | null;
  max_words: number | null;
};

type ChatResult = {
  answer: string;
  sources: string[];
  error?: string;
};

type AuditQuestion = {
  query: string;
  expectedSources: string[];
  expectedAnswerTerms: string[];
};

const questions: AuditQuestion[] = [
  {
    query: 'How to be a validator in Logos?',
    expectedSources: ['Quickstart guide for the Logos Blockchain node', 'Logos Node Quickstart'],
    expectedAnswerTerms: ['node', 'consensus', 'faucet'],
  },
  {
    query: 'What are the staking requirements and registration commands for Logos validators?',
    expectedSources: ['Quickstart guide for the Logos Blockchain node', 'Logos | Node Programme', 'Testnet'],
    expectedAnswerTerms: ['faucet', 'consensus', 'lottery'],
  },
  {
    query: 'What are Logos Improvement Proposals?',
    expectedSources: ['Logos LIP', 'Logos Improvement Proposals'],
    expectedAnswerTerms: ['proposal', 'specification', 'review'],
  },
  {
    query: 'How do Waku nodes discover peers?',
    expectedSources: ['Bootstrap Nodes and Discover Peers', 'Waku'],
    expectedAnswerTerms: ['bootstrap', 'peer', 'discovery'],
  },
  {
    query: 'What is Cryptarchia?',
    expectedSources: ['Cryptarchia', 'Carnot', 'Quickstart guide for the Logos Blockchain node'],
    expectedAnswerTerms: ['consensus', 'block', 'stake'],
  },
];

const chatApiUrl = (): string => process.env.CHAT_API_URL ?? 'http://127.0.0.1:3010/api/chat';

const skipChat = (): boolean => process.env.RAG_AUDIT_SKIP_CHAT === '1';

const finalK = (): number => Number(process.env.RAG_AUDIT_FINAL_K ?? 5);

type DbClient = typeof import('../src/db').default;
type RetrievalService = typeof import('../src/app/services/retrieval-service').default;
type DatabaseService = typeof import('../src/app/services/database-service').default;

let db: DbClient;
let retrievalService: RetrievalService;
let databaseService: DatabaseService;

const loadServices = async (): Promise<void> => {
  const [dbModule, retrievalModule, databaseModule] = await Promise.all([
    import('../src/db'),
    import('../src/app/services/retrieval-service'),
    import('../src/app/services/database-service'),
  ]);

  db = dbModule.default;
  retrievalService = retrievalModule.default;
  databaseService = databaseModule.default;
};

const normalizeGoogleCredentialsPath = (): void => {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hostCredentialsPath = process.env.HOST_GCP_SA_JSON;

  if (credentialsPath && existsSync(credentialsPath)) return;
  if (!hostCredentialsPath || !existsSync(hostCredentialsPath)) return;

  process.env.GOOGLE_APPLICATION_CREDENTIALS = hostCredentialsPath;
};

const printSection = (title: string): void => {
  console.log(`\n=== ${title} ===`);
};

const includesAny = (text: string, terms: string[]): boolean => {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
};

const fetchChatAnswer = async (query: string): Promise<ChatResult> => {
  const response = await fetch(chatApiUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    body: JSON.stringify({
      sessionId: `rag-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: query }],
        },
      ],
    }),
  });

  const body = await response.text();
  const result: ChatResult = { answer: '', sources: [] };

  if (!response.ok) {
    return {
      ...result,
      error: `HTTP ${response.status}: ${body.slice(0, 240)}`,
    };
  }

  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;

    try {
      const event = JSON.parse(line.slice('data: '.length)) as {
        type?: string;
        delta?: string;
        errorText?: string;
        messageMetadata?: {
          sources?: Array<{ title: string }>;
        };
      };

      if (event.type === 'text-delta') {
        result.answer += event.delta ?? '';
      }

      if (event.errorText) {
        result.error = event.errorText;
      }

      if (event.messageMetadata?.sources) {
        result.sources = event.messageMetadata.sources.map((source) => source.title);
      }
    } catch {
      result.error = result.error ?? `Unparseable stream line: ${line.slice(0, 160)}`;
    }
  }

  return result;
};

const printCorpusHealth = async (): Promise<void> => {
  const corpusRows = await db.execute<CorpusRow>(sql`
    SELECT
      s.source_type,
      COUNT(DISTINCT s.id)::text AS sources,
      COUNT(c.id)::text AS chunks,
      COALESCE(SUM(c.token_count), 0)::text AS words
    FROM logos_sources s
    LEFT JOIN logos_chunks c ON c.source_id = s.id
    GROUP BY s.source_type
    ORDER BY s.source_type
  `);

  const embeddingRows = await db.execute<EmbeddingRow>(sql`
    SELECT
      embedding_model,
      COUNT(*)::text AS chunks,
      MIN(token_count) AS min_words,
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY token_count))::numeric, 1)::text AS median_words,
      MAX(token_count) AS max_words
    FROM logos_chunks
    GROUP BY embedding_model
    ORDER BY embedding_model
  `);

  printSection('Corpus By Source Type');
  console.table(corpusRows);

  printSection('Chunks By Embedding Model');
  console.table(embeddingRows);
};

const auditQuestion = async (question: AuditQuestion): Promise<number> => {
  let failures = 0;
  const retrieval = await retrievalService.search(question.query, { finalK: finalK() });
  const sourceTitles = retrieval.chunks.map((chunk) => chunk.sourceTitle);

  printSection(question.query);
  console.log(`rewritten: ${retrieval.rewritten}`);
  console.table(
    retrieval.chunks.map((chunk, index) => ({
      rank: index + 1,
      id: chunk.id,
      score: chunk.rerankScore,
      sourceType: chunk.sourceType,
      title: chunk.sourceTitle,
      preview: chunk.content.slice(0, 140),
    })),
  );

  if (!includesAny(sourceTitles.join('\n'), question.expectedSources)) {
    failures += 1;
    console.warn(`retrieval warning: expected one of ${question.expectedSources.join(', ')}`);
  }

  if (skipChat()) return failures;

  const chat = await fetchChatAnswer(question.query);
  console.log(`answer: ${chat.answer.slice(0, 700)}${chat.answer.length > 700 ? '...' : ''}`);
  console.log(`answer sources: ${chat.sources.join(' | ') || 'none'}`);

  if (chat.error) {
    failures += 1;
    console.warn(`chat warning: ${chat.error}`);
  }

  if (!includesAny(chat.answer, question.expectedAnswerTerms)) {
    failures += 1;
    console.warn(`answer warning: expected one of ${question.expectedAnswerTerms.join(', ')}`);
  }

  return failures;
};

const run = async (): Promise<void> => {
  loadEnvConfig(process.cwd());
  normalizeGoogleCredentialsPath();
  await loadServices();
  await printCorpusHealth();

  let failures = 0;
  for (const question of questions) {
    failures += await auditQuestion(question);
  }

  if (failures > 0) {
    throw new Error(`RAG audit completed with ${failures} warning(s) that need review`);
  }
};

run()
  .finally(async () => {
    await databaseService?.close();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
