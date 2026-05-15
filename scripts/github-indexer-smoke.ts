import databaseService from '../src/app/services/database-service';
import retrievalService from '../src/app/services/retrieval-service';
import sourceService from '../src/app/services/source-service';
import { mockEmbedding } from '../src/lib/vector';

const defaultRepos = ['logos-co/logos-docs', 'logos-co/logos-lips', 'logos-blockchain/logos-blockchain-specs'];

const expectedRepos = (process.env.INDEXER_GITHUB_REPO_ALLOWLIST ?? defaultRepos.join(','))
  .split(',')
  .map((repo) => repo.trim())
  .filter(Boolean);

const assertSmokeDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for GitHub indexer smoke');

  const hostname = new URL(databaseUrl).hostname;
  const allowedHosts = new Set(['localhost', '127.0.0.1', 'postgres']);
  if (!allowedHosts.has(hostname) && process.env.ALLOW_GITHUB_INDEXER_SMOKE_NON_LOCAL !== '1') {
    throw new Error(`Refusing to run GitHub indexer smoke against non-local database host: ${hostname}`);
  }
};

const run = async () => {
  assertSmokeDatabaseUrl();
  const sources = await sourceService.list();

  for (const repo of expectedRepos) {
    const prefix = `github:${repo}:`;
    const matchingSources = sources.filter((source) => source.identifier.startsWith(prefix));

    if (matchingSources.length === 0) {
      throw new Error(`Expected at least one indexed GitHub source with prefix ${prefix}`);
    }

    const chunkCounts = await Promise.all(matchingSources.map((source) => sourceService.countChunks(source.id)));
    if (chunkCounts.reduce((sum, count) => sum + count, 0) < 1) {
      throw new Error(`Expected indexed chunks for GitHub source prefix ${prefix}`);
    }
  }

  const query = 'Logos Improvement Proposals specification';
  const result = await retrievalService.search(query, {
    queryEmbedding: mockEmbedding(query),
    embeddingModel: 'mock-embedding-768',
    skipRewrite: true,
    skipRerank: true,
    finalK: 12,
  });

  console.log(JSON.stringify(result, null, 2));

  const hasGitHubSource = result.chunks.some((chunk) => chunk.sourceUrl.includes('github.com/'));
  if (!hasGitHubSource) {
    throw new Error('Expected retrieval results to include a GitHub source');
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
