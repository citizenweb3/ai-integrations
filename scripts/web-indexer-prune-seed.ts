import chunkService from '../src/app/services/chunk-service';
import databaseService from '../src/app/services/database-service';
import sourceService from '../src/app/services/source-service';
import { mockEmbedding } from '../src/lib/vector';

const obsoleteIdentifier = 'web:logos-co:https://logos.co/__obsolete-smoke';

const assertSmokeDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for web indexer prune seed');

  const hostname = new URL(databaseUrl).hostname;
  const allowedHosts = new Set(['localhost', '127.0.0.1', 'postgres']);
  if (!allowedHosts.has(hostname) && process.env.ALLOW_WEB_INDEXER_SMOKE_NON_LOCAL !== '1') {
    throw new Error(`Refusing to run web indexer prune seed against non-local database host: ${hostname}`);
  }
};

const run = async () => {
  assertSmokeDatabaseUrl();

  const source = await sourceService.upsert({
    sourceType: 'html',
    identifier: obsoleteIdentifier,
    title: 'Obsolete Logos Web Smoke Source',
    url: 'https://logos.co/__obsolete-smoke',
    contentHash: 'obsolete-web-smoke',
    remoteRevision: 'obsolete-web-smoke',
    lastFetchedAt: new Date(),
    metadata: { smoke: true, obsolete: true },
  });

  await chunkService.replaceForSource(source.id, [
    {
      chunkIndex: 0,
      sectionPath: 'Smoke',
      content: 'This obsolete web smoke chunk should be pruned by the next successful Logos web crawl.',
      contextPrefix: 'This chunk comes from an obsolete web smoke source.',
      contentForEmbed:
        'This chunk comes from an obsolete web smoke source.\n\nThis obsolete web smoke chunk should be pruned by the next successful Logos web crawl.',
      embedding: mockEmbedding('obsolete web smoke chunk should be pruned'),
      embeddingModel: 'mock-embedding-768',
      tokenCount: 15,
      language: 'en',
    },
  ]);
};

run()
  .finally(async () => {
    await databaseService.close();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
