import cron from 'node-cron';

import databaseService from '../src/app/services/database-service';
import sourceService from '../src/app/services/source-service';
import { indexerSources } from './config';
import { runSourceJob } from './jobs/source-job';
import type { IndexerSource, SourceJobResult } from './types';

type LogLevel = 'info' | 'warn' | 'error';

const log = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
  console.log(
    JSON.stringify({
      service: 'logos-chatbot-indexer',
      level,
      event,
      ...fields,
    }),
  );
};

const activeJobs = new Map<string, Promise<SourceJobResult>>();
const shutdownGraceMs = Number(process.env.INDEXER_SHUTDOWN_GRACE_MS ?? 25_000);
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

const runJob = async (source: IndexerSource, trigger: 'cron' | 'once'): Promise<SourceJobResult | null> => {
  if (activeJobs.has(source.id)) {
    log('warn', 'job_skipped_already_running', { sourceId: source.id, trigger });
    return null;
  }

  const startedAt = Date.now();
  log('info', 'job_started', { sourceId: source.id, title: source.title, trigger });

  const jobPromise = runSourceJob(source);
  activeJobs.set(source.id, jobPromise);

  try {
    const result = await jobPromise;
    log('info', 'job_completed', {
      ...result,
      trigger,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    if (source.errorRecord) {
      await sourceService.markFetchErrorByIdentifier(source.errorRecord.identifier, {
        sourceType: source.errorRecord.sourceType,
        title: source.errorRecord.title,
        url: source.errorRecord.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    log('error', 'job_failed', {
      sourceId: source.id,
      trigger,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (activeJobs.get(source.id) === jobPromise) {
      activeJobs.delete(source.id);
    }
  }
};

const enabledSources = () => indexerSources.filter((source) => source.enabled);

const assertLocalDatabaseIfRequired = () => {
  if (process.env.INDEXER_REQUIRE_LOCAL_DATABASE !== '1') return;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('INDEXER_REQUIRE_LOCAL_DATABASE=1 requires DATABASE_URL to be set');
  }

  const parsed = new URL(databaseUrl);
  if (!localDatabaseHosts.has(parsed.hostname)) {
    throw new Error(`Refusing to run indexer smoke against non-local database host: ${parsed.hostname}`);
  }
};

const runOnce = async (): Promise<void> => {
  assertLocalDatabaseIfRequired();
  const sources = enabledSources();
  log('info', 'run_once_started', { sources: sources.map((source) => source.id) });
  let failureCount = 0;

  for (const source of sources) {
    try {
      const result = await runJob(source, 'once');
      failureCount += result?.failed ?? 0;
    } catch {
      failureCount += 1;
    }
  }

  log('info', 'run_once_completed', { sourceCount: sources.length, failureCount });

  if (failureCount > 0) {
    throw new Error(`Indexer one-shot completed with ${failureCount} failure(s)`);
  }
};

const startCron = () => {
  const sources = enabledSources();
  const tasks = sources.map((source) => {
    if (!cron.validate(source.schedule)) {
      throw new Error(`Invalid cron schedule for ${source.id}: ${source.schedule}`);
    }

    const task = cron.schedule(source.schedule, () => {
      void runJob(source, 'cron').catch(() => {
        // runJob already logs the failure; keep the cron process alive for future schedules.
      });
    });

    log('info', 'job_scheduled', {
      sourceId: source.id,
      title: source.title,
      schedule: source.schedule,
    });

    return task;
  });

  if (sources.length === 0) {
    log('warn', 'no_sources_enabled');
  }

  const heartbeat = setInterval(() => {
    log('info', 'heartbeat', {
      uptimeSeconds: Math.round(process.uptime()),
      activeJobs: Array.from(activeJobs.keys()),
      scheduledJobs: sources.length,
    });
  }, 60_000);

  const drainActiveJobs = async () => {
    if (activeJobs.size === 0) return;

    log('info', 'shutdown_waiting_for_jobs', {
      activeJobs: Array.from(activeJobs.keys()),
      graceMs: shutdownGraceMs,
    });

    const jobsFinished = Promise.allSettled(Array.from(activeJobs.values()));
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), shutdownGraceMs);
    });

    const result = await Promise.race([jobsFinished, timeout]);
    if (result === 'timeout') {
      log('warn', 'shutdown_grace_timeout', {
        activeJobs: Array.from(activeJobs.keys()),
        graceMs: shutdownGraceMs,
      });
    }
  };

  const shutdown = async (signal: NodeJS.Signals) => {
    clearInterval(heartbeat);
    for (const task of tasks) {
      task.stop();
    }

    await drainActiveJobs();
    await databaseService.close();
    log('info', 'shutdown', { signal });
    process.exit(0);
  };

  process.on('SIGTERM', (signal) => void shutdown(signal));
  process.on('SIGINT', (signal) => void shutdown(signal));
};

if (process.env.INDEXER_RUN_ONCE === '1') {
  runOnce()
    .then(async () => {
      await databaseService.close();
      process.exit(0);
    })
    .catch(async (error) => {
      await databaseService.close();
      log('error', 'run_once_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
} else {
  assertLocalDatabaseIfRequired();
  log('info', 'started', { mode: 'cron' });
  startCron();
}
