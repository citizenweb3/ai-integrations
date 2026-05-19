import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerLogger } from "../../../apps/worker/src/logger";

test("worker logger emits single-line JSON and preserves correlationId", () => {
  const lines = withLogLevel("warn", () => {
    const captured: string[] = [];
    const logger = createWorkerLogger("test-worker", {
      write(chunk: string) {
        captured.push(chunk);
      }
    });

    logger.debug({ event: "debug_hidden" });
    logger.info({ event: "info_hidden" });
    logger.warn({ event: "warn_visible", correlationId: "corr-t010" });

    return captured;
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /\n$/);
  assert.equal(lines[0]!.split("\n").filter(Boolean).length, 1);

  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.event, "warn_visible");
  assert.equal(parsed.service, "test-worker");
  assert.equal(parsed.correlationId, "corr-t010");
  assert.equal(typeof parsed.ts, "string");
});

test("worker logger honors default info level and debug override", () => {
  const defaultLines = withLogLevel(undefined, () => {
    const captured: string[] = [];
    const logger = createWorkerLogger("test-worker", {
      write(chunk: string) {
        captured.push(chunk);
      }
    });

    logger.debug({ event: "debug_hidden" });
    logger.info({ event: "info_visible" });

    return captured;
  });

  assert.equal(defaultLines.length, 1);
  assert.equal(JSON.parse(defaultLines[0]!).event, "info_visible");

  const debugLines = withLogLevel("debug", () => {
    const captured: string[] = [];
    const logger = createWorkerLogger("test-worker", {
      write(chunk: string) {
        captured.push(chunk);
      }
    });

    logger.debug({ event: "debug_visible" });

    return captured;
  });

  assert.equal(debugLines.length, 1);
  assert.equal(JSON.parse(debugLines[0]!).event, "debug_visible");
});

function withLogLevel<T>(level: string | undefined, run: () => T): T {
  const previous = process.env.LOG_LEVEL;
  if (level === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = level;
  }

  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  }
}
