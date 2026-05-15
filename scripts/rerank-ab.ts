import retrievalService from '../src/app/services/retrieval-service';
import databaseService from '../src/app/services/database-service';

const QUERIES = [
  'What are Logos Improvement Proposals?',
  'How do I run a Logos blockchain node?',
  'Explain Waku architecture in one paragraph.',
  'What is Nomos and how does it relate to Logos?',
  'How does Cryptarchia consensus work?',
  'Where can I find the Logos Execution Zone wallet quickstart?',
];

type Run = {
  label: string;
  retrievalMs: number;
  rewriteMs: number;
  embedMs: number;
  searchMs: number;
  rerankMs: number;
  top: { rank: number; title: string; section: string | null; url: string }[];
};

const summarize = (
  query: string,
  result: Awaited<ReturnType<typeof retrievalService.search>>,
  label: string,
): Run => ({
  label,
  retrievalMs: result.retrievalLatencyMs,
  rewriteMs: result.stepTimings.rewriteMs,
  embedMs: result.stepTimings.embedMs,
  searchMs: result.stepTimings.searchMs,
  rerankMs: result.stepTimings.rerankMs,
  top: result.chunks.slice(0, 8).map((chunk, index) => ({
    rank: index + 1,
    title: chunk.sourceTitle,
    section: chunk.sectionPath,
    url: chunk.sourceUrl,
  })),
});

const diffTopSets = (a: Run, b: Run): { overlap: number; shifted: number } => {
  const aIds = new Set(a.top.map((entry) => `${entry.title}::${entry.section ?? ''}`));
  const bIds = new Set(b.top.map((entry) => `${entry.title}::${entry.section ?? ''}`));
  let overlap = 0;
  for (const id of aIds) if (bIds.has(id)) overlap += 1;
  let shifted = 0;
  for (let i = 0; i < a.top.length; i += 1) {
    const key = `${a.top[i].title}::${a.top[i].section ?? ''}`;
    const j = b.top.findIndex((entry) => `${entry.title}::${entry.section ?? ''}` === key);
    if (j >= 0 && j !== i) shifted += 1;
  }
  return { overlap, shifted };
};

const run = async () => {
  const allRuns: { query: string; withRerank: Run; withoutRerank: Run }[] = [];

  for (const query of QUERIES) {
    console.log(`\n=== ${query}`);

    const withRerank = await retrievalService.search(query, { finalK: 8 });
    const withRerankRun = summarize(query, withRerank, 'rerank');

    const withoutRerank = await retrievalService.search(query, { finalK: 8, skipRerank: true });
    const withoutRerankRun = summarize(query, withoutRerank, 'no_rerank');

    allRuns.push({ query, withRerank: withRerankRun, withoutRerank: withoutRerankRun });

    const diff = diffTopSets(withRerankRun, withoutRerankRun);
    console.log(
      JSON.stringify(
        {
          retrieval_ms: { rerank: withRerankRun.retrievalMs, no_rerank: withoutRerankRun.retrievalMs },
          rerank_ms: withRerankRun.rerankMs,
          top8_overlap: `${diff.overlap}/8`,
          top8_rank_shifted: diff.shifted,
        },
        null,
        2,
      ),
    );
    console.log('-- top with rerank:');
    for (const entry of withRerankRun.top) {
      console.log(`  ${entry.rank}. ${entry.title} :: ${entry.section ?? '-'}`);
    }
    console.log('-- top no rerank:');
    for (const entry of withoutRerankRun.top) {
      console.log(`  ${entry.rank}. ${entry.title} :: ${entry.section ?? '-'}`);
    }
  }

  const totals = allRuns.reduce(
    (acc, item) => {
      acc.rerankMs += item.withRerank.retrievalMs;
      acc.noRerankMs += item.withoutRerank.retrievalMs;
      acc.rerankOnly += item.withRerank.rerankMs;
      const diff = diffTopSets(item.withRerank, item.withoutRerank);
      acc.overlap += diff.overlap;
      acc.shifted += diff.shifted;
      return acc;
    },
    { rerankMs: 0, noRerankMs: 0, rerankOnly: 0, overlap: 0, shifted: 0 },
  );

  const n = allRuns.length;
  console.log('\n=== AVERAGES (n=' + n + ')');
  console.log(
    JSON.stringify(
      {
        retrieval_with_rerank_avg_ms: Math.round(totals.rerankMs / n),
        retrieval_no_rerank_avg_ms: Math.round(totals.noRerankMs / n),
        rerank_step_avg_ms: Math.round(totals.rerankOnly / n),
        savings_avg_ms: Math.round((totals.rerankMs - totals.noRerankMs) / n),
        top8_overlap_avg: `${(totals.overlap / n).toFixed(1)}/8`,
        top8_rank_shifted_avg: (totals.shifted / n).toFixed(1),
      },
      null,
      2,
    ),
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await databaseService.close();
  });
