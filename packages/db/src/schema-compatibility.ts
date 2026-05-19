import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./client";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = resolve(packageDir, "drizzle");

type MigrationRecord = {
  filename: string;
  checksum: string;
};

export type SchemaCompatibilitySnapshot = {
  compatible: boolean;
  expectedVersion: string | null;
  appliedVersion: string | null;
  expectedCount: number;
  appliedCount: number;
  missingMigrations: string[];
  checksumMismatches: string[];
  unknownMigrations: string[];
  error?: string;
};

export async function getSchemaCompatibility(): Promise<SchemaCompatibilitySnapshot> {
  const expectedMigrations = await getExpectedMigrations();
  const expectedVersion = expectedMigrations.at(-1)?.filename ?? null;

  if (!await tableExists("schema_migrations")) {
    return {
      compatible: false,
      expectedVersion,
      appliedVersion: null,
      expectedCount: expectedMigrations.length,
      appliedCount: 0,
      missingMigrations: expectedMigrations.map((migration) => migration.filename),
      checksumMismatches: [],
      unknownMigrations: [],
      error: "schema_migrations table is missing"
    };
  }

  const appliedMigrations = await getAppliedMigrations();
  const appliedVersion = appliedMigrations.at(-1)?.filename ?? null;
  const expectedByFilename = new Map(
    expectedMigrations.map((migration) => [migration.filename, migration])
  );
  const appliedByFilename = new Map(
    appliedMigrations.map((migration) => [migration.filename, migration])
  );

  const missingMigrations = expectedMigrations
    .filter((migration) => !appliedByFilename.has(migration.filename))
    .map((migration) => migration.filename);
  const checksumMismatches = expectedMigrations
    .filter((migration) => {
      const applied = appliedByFilename.get(migration.filename);
      return Boolean(applied && applied.checksum !== migration.checksum);
    })
    .map((migration) => migration.filename);
  const unknownMigrations = appliedMigrations
    .filter((migration) => !expectedByFilename.has(migration.filename))
    .map((migration) => migration.filename);
  const compatible = missingMigrations.length === 0
    && checksumMismatches.length === 0
    && unknownMigrations.length === 0;

  return {
    compatible,
    expectedVersion,
    appliedVersion,
    expectedCount: expectedMigrations.length,
    appliedCount: appliedMigrations.length,
    missingMigrations,
    checksumMismatches,
    unknownMigrations
  };
}

export async function assertSchemaCompatibility(): Promise<SchemaCompatibilitySnapshot> {
  const compatibility = await getSchemaCompatibility();
  if (!compatibility.compatible) {
    throw new Error(`Database schema is incompatible: ${describeIncompatibility(compatibility)}`);
  }

  return compatibility;
}

async function getExpectedMigrations(): Promise<MigrationRecord[]> {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const migrations: MigrationRecord[] = [];
  for (const file of migrationFiles) {
    const migration = await readFile(resolve(migrationsDir, file), "utf8");
    migrations.push({
      filename: file,
      checksum: createHash("sha256").update(migration).digest("hex")
    });
  }

  return migrations;
}

async function getAppliedMigrations(): Promise<MigrationRecord[]> {
  const rows = await getDb().execute(sql<MigrationRecord>`
    select filename, checksum
    from schema_migrations
    order by filename
  `);
  return rows as unknown as MigrationRecord[];
}

async function tableExists(tableName: string): Promise<boolean> {
  const [row] = await getDb().execute(sql<{ exists: boolean }>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as "exists"
  `) as unknown as Array<{ exists: boolean }>;
  return row?.exists ?? false;
}

function describeIncompatibility(compatibility: SchemaCompatibilitySnapshot): string {
  const reasons: string[] = [];
  if (compatibility.error) {
    reasons.push(compatibility.error);
  }
  if (compatibility.missingMigrations.length > 0) {
    reasons.push(`missing migrations: ${compatibility.missingMigrations.join(", ")}`);
  }
  if (compatibility.checksumMismatches.length > 0) {
    reasons.push(`checksum mismatches: ${compatibility.checksumMismatches.join(", ")}`);
  }
  if (compatibility.unknownMigrations.length > 0) {
    reasons.push(`unknown migrations: ${compatibility.unknownMigrations.join(", ")}`);
  }

  return reasons.join("; ") || "unknown mismatch";
}
