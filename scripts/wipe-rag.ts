import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

const run = async (): Promise<void> => {
  await sql`TRUNCATE TABLE logos_chunks, logos_sources RESTART IDENTITY CASCADE`;
  console.log('RAG tables wiped: logos_chunks, logos_sources');
};

run()
  .finally(async () => {
    await sql.end();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
