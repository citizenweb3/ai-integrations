import databaseService from '../src/app/services/database-service';
import retrievalService from '../src/app/services/retrieval-service';
import sourceService from '../src/app/services/source-service';
import { mockEmbedding } from '../src/lib/vector';

const expectedSources = [
  'static:logos-node-quickstart',
  'static:logos-waku-messaging',
  'static:logos-cryptarchia',
];

const assertSmokeDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for indexer smoke');

  const hostname = new URL(databaseUrl).hostname;
  const allowedHosts = new Set(['localhost', '127.0.0.1', 'postgres']);
  if (!allowedHosts.has(hostname) && process.env.ALLOW_INDEXER_SMOKE_NON_LOCAL !== '1') {
    throw new Error(`Refusing to run indexer smoke against non-local database host: ${hostname}`);
  }
};

const run = async () => {
  assertSmokeDatabaseUrl();

  for (const identifier of expectedSources) {
    const source = await sourceService.findByIdentifier(identifier);
    if (!source) {
      throw new Error(`Expected indexed source ${identifier}`);
    }

    const chunkCount = await sourceService.countChunks(source.id);
    if (chunkCount < 1) {
      throw new Error(`Expected source ${identifier} to have at least one chunk`);
    }
  }

  const originalApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  try {
    const query = 'How do I run a Logos node?';
    const result = await retrievalService.search(query, {
      queryEmbedding: mockEmbedding(query),
      embeddingModel: 'mock-embedding-768',
      skipRewrite: true,
      finalK: 3,
    });

    console.log(JSON.stringify(result, null, 2));

    const top = result.chunks[0];
    if (!top || top.sourceTitle !== 'Logos Node Quickstart') {
      throw new Error(`Expected Logos Node Quickstart as top result, got ${top?.sourceTitle ?? 'none'}`);
    }
  } finally {
    if (originalApiKey) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalApiKey;
    }
  }
};

run()
  .finally(async () => {
    await databaseService.close();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
