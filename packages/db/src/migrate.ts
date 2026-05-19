import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getDatabaseUrl } from "./client";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = resolve(packageDir, "drizzle");
const initialMigrationTables = [
  "campaigns",
  "organizations",
  "contacts",
  "outreach_records",
  "threads",
  "thread_participants",
  "drafts",
  "outbound_messages",
  "inbound_messages",
  "suppression_entries",
  "webhook_events",
  "commands",
  "jobs",
  "job_runs",
  "event_log",
  "agent_runs",
  "agent_run_events",
  "agent_run_artifacts",
  "research_snapshots",
  "research_facts",
  "research_evidence",
  "research_fact_evidence",
  "research_contact_candidates",
  "draft_claims",
  "draft_claim_fact_refs",
  "operator_feedback",
  "rag_documents",
  "rag_chunks",
  "rag_embeddings"
] as const;

const db = postgres(getDatabaseUrl(), { max: 1 });

try {
  if (!await tableExists("schema_migrations")) {
    await db`
      create table schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now(),
        execution_ms integer not null default 0,
        applied_by text not null default 'local'
      )
    `;
  }

  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const migrationPath = resolve(migrationsDir, file);
    const migration = await readFile(migrationPath, "utf8");
    const checksum = createHash("sha256").update(migration).digest("hex");
    const [applied] = await db<{ checksum: string }[]>`
      select checksum from schema_migrations where filename = ${file}
    `;

    if (applied) {
      if (applied.checksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${file}`);
      }
      console.log(`Skipped already applied migration ${file}`);
      continue;
    }

    if (file === "0000_initial.sql" && await tableExists("campaigns")) {
      await assertInitialBaselineIsComplete(file);
      await db`
        insert into schema_migrations (filename, checksum, execution_ms, applied_by)
        values (${file}, ${checksum}, 0, 'baseline-existing-schema')
      `;
      console.log(`Baselined existing schema for ${file}`);
      continue;
    }

    const startedAt = Date.now();
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    await db.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }

      await tx`
        insert into schema_migrations (filename, checksum, execution_ms, applied_by)
        values (${file}, ${checksum}, ${Date.now() - startedAt}, 'local')
      `;
    });

    console.log(`Applied ${statements.length} migration statements from ${migrationPath}`);
  }
} finally {
  await db.end({ timeout: 5 });
}

async function tableExists(tableName: string): Promise<boolean> {
  const [row] = await db<{ exists: boolean }[]>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as "exists"
  `;
  return row?.exists ?? false;
}

async function assertInitialBaselineIsComplete(filename: string): Promise<void> {
  const missingTables: string[] = [];
  for (const tableName of initialMigrationTables) {
    if (!await tableExists(tableName)) {
      missingTables.push(tableName);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(
      `Cannot baseline ${filename}: existing schema is incomplete. Missing tables: ${missingTables.join(", ")}`
    );
  }

  if (!await extensionExists("vector")) {
    throw new Error(`Cannot baseline ${filename}: missing required vector extension`);
  }
}

async function extensionExists(extensionName: string): Promise<boolean> {
  const [row] = await db<{ exists: boolean }[]>`
    select exists (
      select 1
      from pg_extension
      where extname = ${extensionName}
    ) as "exists"
  `;
  return row?.exists ?? false;
}
