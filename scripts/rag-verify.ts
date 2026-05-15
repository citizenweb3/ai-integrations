import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

type DistributionRow = {
  source_type: string;
  chunk_count: string;
};

type SectionPathRow = {
  total: string;
  with_path: string;
};

type ChunkSizeRow = {
  avg_tokens: number | null;
  min_tokens: number | null;
  max_tokens: number | null;
  at_cap_count: string;
  total: string;
};

type BoilerplateRow = {
  hit_count: string;
};

type CheckResult = {
  name: string;
  passed: boolean;
  detail: string;
};

const sql = postgres(databaseUrl, { max: 1 });

const formatPercent = (numerator: number, denominator: number): string => {
  if (denominator === 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
};

const checkDistribution = async (): Promise<CheckResult> => {
  const rows = await sql<DistributionRow[]>`
    SELECT s.source_type, COUNT(c.id)::text AS chunk_count
    FROM logos_chunks c
    JOIN logos_sources s ON s.id = c.source_id
    GROUP BY s.source_type
    ORDER BY chunk_count DESC
  `;

  const tabulated = rows.map((row) => ({
    source_type: row.source_type,
    chunk_count: Number(row.chunk_count),
  }));

  console.log('\n=== Check 1: Chunk distribution by source_type ===');
  console.table(tabulated);

  const total = tabulated.reduce((acc, row) => acc + row.chunk_count, 0);
  if (total === 0) {
    return { name: 'distribution', passed: false, detail: 'no chunks present' };
  }

  const githubSourceTypes = new Set(['github_readme', 'github_markdown', 'lip', 'spec']);
  const githubFamily = tabulated
    .filter((row) => githubSourceTypes.has(row.source_type))
    .reduce((acc, row) => acc + row.chunk_count, 0);

  const githubPct = githubFamily / total;
  const largestShare = Math.max(...tabulated.map((row) => row.chunk_count));
  const maxShare = largestShare / total;

  const detailParts: string[] = [
    `github family ${formatPercent(githubFamily, total)}`,
    `largest source_type ${formatPercent(largestShare, total)}`,
  ];

  if (githubPct <= 0.5) {
    return {
      name: 'distribution',
      passed: false,
      detail: `${detailParts.join(', ')} — expected github family > 50%`,
    };
  }

  if (maxShare > 0.75) {
    return {
      name: 'distribution',
      passed: false,
      detail: `${detailParts.join(', ')} — single source_type exceeds 75% cap`,
    };
  }

  return { name: 'distribution', passed: true, detail: detailParts.join(', ') };
};

const checkSectionPathCoverage = async (): Promise<CheckResult> => {
  const [row] = await sql<SectionPathRow[]>`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE section_path IS NOT NULL)::text AS with_path
    FROM logos_chunks
  `;

  const total = Number(row.total);
  const withPath = Number(row.with_path);
  const coverage = total === 0 ? 0 : withPath / total;

  console.log('\n=== Check 2: section_path coverage ===');
  console.table([{ total, with_path: withPath, coverage: formatPercent(withPath, total) }]);

  if (total === 0) {
    return { name: 'section_path coverage', passed: false, detail: 'no chunks present' };
  }

  if (coverage < 0.5) {
    return {
      name: 'section_path coverage',
      passed: false,
      detail: `${formatPercent(withPath, total)} < 50%`,
    };
  }

  return { name: 'section_path coverage', passed: true, detail: formatPercent(withPath, total) };
};

const checkChunkSize = async (): Promise<CheckResult> => {
  const [row] = await sql<ChunkSizeRow[]>`
    SELECT
      AVG(token_count)::int AS avg_tokens,
      MIN(token_count) AS min_tokens,
      MAX(token_count) AS max_tokens,
      COUNT(*) FILTER (WHERE token_count > 600)::text AS at_cap_count,
      COUNT(*)::text AS total
    FROM logos_chunks
  `;

  const total = Number(row.total);
  const atCap = Number(row.at_cap_count);
  const atCapShare = total === 0 ? 0 : atCap / total;

  console.log('\n=== Check 3: chunk size sanity ===');
  console.table([
    {
      avg_tokens: row.avg_tokens,
      min_tokens: row.min_tokens,
      max_tokens: row.max_tokens,
      at_cap_count: atCap,
      total,
      at_cap_share: formatPercent(atCap, total),
    },
  ]);

  if (total === 0) {
    return { name: 'chunk size', passed: false, detail: 'no chunks present' };
  }

  if (atCapShare >= 0.3) {
    return {
      name: 'chunk size',
      passed: false,
      detail: `${formatPercent(atCap, total)} chunks above 600 tokens (>= 30%)`,
    };
  }

  return { name: 'chunk size', passed: true, detail: `${formatPercent(atCap, total)} above 600 tokens` };
};

const checkBoilerplate = async (): Promise<CheckResult> => {
  const [row] = await sql<BoilerplateRow[]>`
    SELECT COUNT(*)::text AS hit_count
    FROM logos_chunks
    WHERE content ~* '(^|\n)\s*skip to (main )?content\s*($|\n)'
       OR content ~* '(^|\n)\s*table of contents\s*($|\n)'
       OR content ~* '(^|\n)\s*on this page\s*($|\n)'
  `;

  const hits = Number(row.hit_count);

  console.log('\n=== Check 4: no nav boilerplate ===');
  console.table([{ hit_count: hits }]);

  if (hits > 0) {
    return { name: 'no nav boilerplate', passed: false, detail: `${hits} chunk(s) contain nav text` };
  }

  return { name: 'no nav boilerplate', passed: true, detail: '0 hits' };
};

const run = async (): Promise<void> => {
  const results: CheckResult[] = [
    await checkDistribution(),
    await checkSectionPathCoverage(),
    await checkChunkSize(),
    await checkBoilerplate(),
  ];

  const passed = results.filter((result) => result.passed).length;
  const failed = results.filter((result) => !result.passed);

  console.log(`\nPASS: ${passed}/${results.length} checks passed`);
  for (const result of failed) {
    console.log(`FAIL: ${result.name} (${result.detail})`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

run()
  .finally(async () => {
    await sql.end();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
