import databaseService from '../src/app/services/database-service';
import retrievalCacheService from '../src/app/services/retrieval-cache-service';
import retrievalService from '../src/app/services/retrieval-service';
import { LOGOS_STARTER_QUESTIONS } from '../src/lib/chat/starter-questions';

const run = async () => {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required to warm the starter cache');
  }

  const startedAt = Date.now();
  let totalRewriteMs = 0;
  let totalEmbedMs = 0;
  let rewriteHits = 0;
  let embedHits = 0;

  for (const [index, question] of LOGOS_STARTER_QUESTIONS.entries()) {
    const result = await retrievalService.search(question, { finalK: 8 });
    const { rewriteMs, embedMs, rewriteCacheHit, embedCacheHit } = result.stepTimings;
    totalRewriteMs += rewriteMs;
    totalEmbedMs += embedMs;
    if (rewriteCacheHit) rewriteHits += 1;
    if (embedCacheHit) embedHits += 1;

    console.log(
      JSON.stringify({
        index: index + 1,
        question,
        rewritten: result.rewritten,
        rewriteMs,
        embedMs,
        rewriteCacheHit,
        embedCacheHit,
      }),
    );
  }

  console.log(
    JSON.stringify({
      summary: true,
      totalQuestions: LOGOS_STARTER_QUESTIONS.length,
      rewriteHits,
      embedHits,
      avgRewriteMs: Math.round(totalRewriteMs / LOGOS_STARTER_QUESTIONS.length),
      avgEmbedMs: Math.round(totalEmbedMs / LOGOS_STARTER_QUESTIONS.length),
      totalMs: Date.now() - startedAt,
    }),
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await retrievalCacheService.close();
    await databaseService.close();
  });
