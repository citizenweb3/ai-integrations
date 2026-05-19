import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DbClient = ReturnType<typeof getDb>;

let postgresClient: postgres.Sql | undefined;
let drizzleClient: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  return url;
}

export function getDb() {
  if (!postgresClient) {
    postgresClient = postgres(getDatabaseUrl(), {
      max: Number(process.env.DATABASE_MAX_CONNECTIONS ?? 5)
    });
  }

  if (!drizzleClient) {
    drizzleClient = drizzle(postgresClient, { schema });
  }

  return drizzleClient;
}

export async function closeDb(): Promise<void> {
  if (postgresClient) {
    await postgresClient.end({ timeout: 5 });
    postgresClient = undefined;
    drizzleClient = undefined;
  }
}
