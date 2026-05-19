import postgres from "postgres";
import { getDatabaseUrl } from "./client";

if (process.env.ALLOW_DB_RESET !== "1") {
  throw new Error("Refusing to reset database without ALLOW_DB_RESET=1");
}

const db = postgres(getDatabaseUrl(), { max: 1 });

try {
  await db.unsafe("drop schema public cascade");
  await db.unsafe("create schema public");
  await db.unsafe("grant all on schema public to public");
  console.log("Reset public schema");
} finally {
  await db.end({ timeout: 5 });
}
