import chunkService from '../src/app/services/chunk-service';
import databaseService from '../src/app/services/database-service';
import rerankService from '../src/app/services/rerank-service';
import retrievalService from '../src/app/services/retrieval-service';
import sourceService from '../src/app/services/source-service';
import { mockEmbedding } from '../src/lib/vector';

const seedDocs = [
  {
    identifier: 'smoke:logos-node',
    title: 'Logos Node Setup',
    url: 'https://build.logos.co/node',
    content:
      'Run a Logos node by installing the node software, syncing with the network, configuring keys, and monitoring peer connectivity.',
    sectionPath: 'Node operations > setup',
  },
  {
    identifier: 'smoke:waku',
    title: 'Waku Messaging',
    url: 'https://docs.waku.org',
    content:
      'Waku provides privacy-preserving peer-to-peer messaging for applications that need decentralized communication.',
    sectionPath: 'Messaging > Waku',
  },
  {
    identifier: 'smoke:cryptarchia',
    title: 'Cryptarchia Consensus',
    url: 'https://logos.co/technology',
    content:
      'Cryptarchia is the consensus component of Logos, designed for privacy-focused coordination and network security.',
    sectionPath: 'Architecture > Consensus',
  },
];

const smokeIdentifiers = seedDocs.map((doc) => doc.identifier);
let shouldCleanup = false;

const assertSmokeDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for retrieval smoke');

  const hostname = new URL(databaseUrl).hostname;
  const allowedHosts = new Set(['localhost', '127.0.0.1', 'postgres']);
  if (!allowedHosts.has(hostname) && process.env.ALLOW_RETRIEVAL_SMOKE_NON_LOCAL !== '1') {
    throw new Error(`Refusing to run retrieval smoke against non-local database host: ${hostname}`);
  }
};

const assertRerankFallback = async () => {
  const originalApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  try {
    const ranked = await rerankService.rerank(
      'logos node',
      [
        {
          id: 101,
          sourceId: 1,
          chunkIndex: 0,
          sectionPath: 'first',
          content: 'first candidate',
          contextPrefix: null,
          language: 'en',
          sourceTitle: 'First',
          sourceUrl: 'https://example.test/first',
          sourceType: 'html',
          rrfScore: 0.2,
        },
        {
          id: 102,
          sourceId: 1,
          chunkIndex: 1,
          sectionPath: 'second',
          content: 'second candidate',
          contextPrefix: null,
          language: 'en',
          sourceTitle: 'Second',
          sourceUrl: 'https://example.test/second',
          sourceType: 'html',
          rrfScore: 0.1,
        },
      ],
      2,
    );

    if (ranked[0]?.id !== 101 || ranked[0]?.rerankScore !== 10 || ranked[1]?.id !== 102) {
      throw new Error('Expected rerank fallback to preserve RRF order');
    }
  } finally {
    if (originalApiKey) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalApiKey;
    }
  }
};

const run = async () => {
  assertSmokeDatabaseUrl();
  shouldCleanup = true;
  await sourceService.deleteByIdentifiers(smokeIdentifiers);

  for (const [index, doc] of seedDocs.entries()) {
    const source = await sourceService.upsert({
      sourceType: 'html',
      identifier: doc.identifier,
      title: doc.title,
      url: doc.url,
      contentHash: `smoke-${index}`,
      remoteRevision: 'smoke',
      lastFetchedAt: new Date(),
      metadata: { smoke: true },
    });

    await chunkService.replaceForSource(source.id, [
      {
        chunkIndex: 0,
        sectionPath: doc.sectionPath,
        content: doc.content,
        contextPrefix: `This chunk comes from ${doc.title}.`,
        contentForEmbed: `This chunk comes from ${doc.title}.\n\n${doc.content}`,
        embedding: mockEmbedding(doc.content),
        embeddingModel: 'mock-embedding-768',
        tokenCount: doc.content.split(/\s+/).length,
        language: 'en',
      },
    ]);
  }

  const query = 'How do I run a Logos node?';
  const result = await retrievalService.search(query, {
    queryEmbedding: mockEmbedding(query),
    embeddingModel: 'mock-embedding-768',
    skipRewrite: true,
    skipRerank: true,
    finalK: 3,
  });

  console.log(JSON.stringify(result, null, 2));

  const top = result.chunks[0];
  if (!top || top.sourceTitle !== 'Logos Node Setup') {
    throw new Error(`Expected Logos Node Setup as top result, got ${top?.sourceTitle ?? 'none'}`);
  }

  await assertRerankFallback();
};

run()
  .finally(async () => {
    if (shouldCleanup) {
      await sourceService.deleteByIdentifiers(smokeIdentifiers);
    }
    await databaseService.close();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
