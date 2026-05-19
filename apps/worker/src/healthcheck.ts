import "dotenv/config";
import { assertSchemaCompatibility, closeDb, getWorkerHeartbeatStatus } from "@bizdev/db";
import { createWorkerLogger } from "./logger";

const workerId = process.env.WORKER_ID;
const maxAgeSeconds = Number(process.env.WORKER_HEALTH_MAX_AGE_SECONDS ?? 30);
const logger = createWorkerLogger("worker-healthcheck");

if (!workerId) {
  logger.error({
    event: "worker_healthcheck_failed",
    ok: false,
    errorMessage: "WORKER_ID is required for worker healthcheck"
  });
  process.exit(1);
}

try {
  const schema = await assertSchemaCompatibility();
  const heartbeat = await getWorkerHeartbeatStatus(workerId, maxAgeSeconds);
  if (!heartbeat?.healthy) {
    logger.error({
      event: "worker_healthcheck_failed",
      ok: false,
      workerId,
      schema,
      heartbeat
    });
    process.exitCode = 1;
  } else {
    logger.info({
      event: "worker_healthcheck_ok",
      ok: true,
      workerId,
      schema,
      lastSeenAt: heartbeat.lastSeenAt
    });
  }
} catch (error) {
  logger.error({
    event: "worker_healthcheck_failed",
    ok: false,
    workerId,
    ...serializeError(error)
  });
  process.exitCode = 1;
} finally {
  await closeDb();
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorStack: error.stack
    };
  }

  return { errorMessage: String(error) };
}
