import databaseService from '../src/app/services/database-service';
import retrievalService from '../src/app/services/retrieval-service';
import sourceService from '../src/app/services/source-service';
import { mockEmbedding } from '../src/lib/vector';

const requiredPrefixes = ['web:logos-co:', 'web:build-logos-co:', 'web:docs-waku-org:'];
const obsoleteIdentifier = 'web:logos-co:https://logos.co/__obsolete-smoke';

const assertSmokeDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for web indexer smoke');

  const hostname = new URL(databaseUrl).hostname;
  const allowedHosts = new Set(['localhost', '127.0.0.1', 'postgres']);
  if (!allowedHosts.has(hostname) && process.env.ALLOW_WEB_INDEXER_SMOKE_NON_LOCAL !== '1') {
    throw new Error(`Refusing to run web indexer smoke against non-local database host: ${hostname}`);
  }
};

const run = async () => {
  assertSmokeDatabaseUrl();
  const sources = await sourceService.list();

  if (sources.some((source) => source.identifier === obsoleteIdentifier)) {
    throw new Error(`Expected obsolete web smoke source to be pruned: ${obsoleteIdentifier}`);
  }

  for (const prefix of requiredPrefixes) {
    const matchingSources = sources.filter((source) => source.identifier.startsWith(prefix));
    if (matchingSources.length === 0) {
      throw new Error(`Expected at least one indexed web source with prefix ${prefix}`);
    }

    const chunkCounts = await Promise.all(matchingSources.map((source) => sourceService.countChunks(source.id)));
    if (chunkCounts.reduce((sum, count) => sum + count, 0) < 1) {
      throw new Error(`Expected indexed chunks for web source prefix ${prefix}`);
    }
  }

  const query = 'What is Waku messaging?';
  const result = await retrievalService.search(query, {
    queryEmbedding: mockEmbedding(query),
    embeddingModel: 'mock-embedding-768',
    skipRewrite: true,
    skipRerank: true,
    finalK: 8,
  });

  console.log(JSON.stringify(result, null, 2));

  const hasWakuSource = result.chunks.some((chunk) => chunk.sourceUrl.includes('docs.waku.org'));
  if (!hasWakuSource) {
    throw new Error('Expected retrieval results to include docs.waku.org');
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
