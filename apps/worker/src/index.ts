import "dotenv/config";
import {
  assertSchemaCompatibility,
  closeDb,
  completeCampaignExpansionJob,
  completeGenerateDraftJob,
  completeGenerateWarmDraftJob,
  completeClassifyReplyJob,
  completeIndexRagDocumentJob,
  completeQueueDepthWatchdogJob,
  completeRefreshResearchSnapshotJob,
  completeResearchMoreJob,
  completeDiscoverContactsJob,
  completeRecoverStaleJobsCronJob,
  completeRollupAgentCostsCronJob,
  completeRotateEventLogCronJob,
  completeRunCampaignDiscoveryJob,
  completeResurfacePolicyStatesJob,
  completeRevalidateDraftClaimsJob,
  completeReviseDraftJob,
  completeSendEmailJob,
  completeSendTelegramNotificationJob,
  completeWebhookProcessingJob,
  completeWorkerHeartbeatWatchdogJob,
  completeCampaignDiscoveryCronJob,
  completeReconcileCampaignDiscoveryCronJob,
  ensureActiveCampaignDiscoveryCronsScheduled,
  ensureBackgroundCronsScheduled,
  failJob,
  leaseNextJob,
  recordWorkerHeartbeat,
  recoverStaleJobs,
  startJobRun,
  stubRagEmbedder,
  traceOperation,
  type AgentStageDispatcher,
  type LeasedJob,
  type SendEmailDispatcher,
  type TelegramNotificationDispatcher
} from "@bizdev/db";
import type { RagEmbedFn } from "@bizdev/db";
import { randomUUID } from "node:crypto";
import { createHttpAgentDispatcher } from "./agentClient";
import { createResendClient } from "./resendClient";
import {
  createVertexRagEmbedder,
  createVertexRagQueryEmbedder,
  readVertexRagEmbedderConfigFromEnv
} from "./vertexRagEmbedder";
import {
  createTelegramClient,
  readTelegramRuntimeConfigFromEnv
} from "./telegramClient";
import { createWorkerLogger, type WorkerLogLevel } from "./logger";

const workerId = process.env.WORKER_ID ?? `worker-${randomUUID()}`;
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000);
const leaseSeconds = Number(process.env.WORKER_LEASE_SECONDS ?? 60);
const heartbeatIntervalMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 5000);
const workerPools = (process.env.WORKER_POOLS ?? "urgent,drafting,background,telegram")
  .split(",")
  .map((pool) => pool.trim())
  .filter(Boolean);
const runOnce = process.env.WORKER_RUN_ONCE === "1";
const logger = createWorkerLogger();

const agentDispatcher: AgentStageDispatcher = (() => {
  const baseUrl = process.env.AGENT_BASE_URL;
  if (!baseUrl) {
    return async function* () {
      yield {
        eventType: "run_failed",
        payloadJson: { error: "AGENT_BASE_URL is not configured" }
      };
    };
  }
  const bearerToken = process.env.AGENT_RUN_SECRET?.trim();
  return bearerToken
    ? createHttpAgentDispatcher({ baseUrl, bearerToken })
    : createHttpAgentDispatcher({ baseUrl });
})();

const sendEmailDispatcher: SendEmailDispatcher = (() => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return async () => ({
      kind: "failed",
      reason: "RESEND_API_KEY is not configured",
      retryable: false
    });
  }
  const client = createResendClient({ apiKey });
  return async (input) => {
    const headers: Record<string, string> = {
      "Message-Id": input.rfc822MessageId
    };
    if (input.inReplyTo) headers["In-Reply-To"] = input.inReplyTo;
    if (input.references.length > 0) headers["References"] = input.references.join(" ");
    return client.send({
      from: input.fromEmail,
      to: input.recipientEmail,
      subject: input.subject,
      text: input.body,
      idempotencyKey: input.outboundIdempotencyKey,
      headers
    });
  };
})();

const ragEmbedder: RagEmbedFn = (() => {
  const provider = (process.env.RAG_EMBED_PROVIDER ?? "stub").toLowerCase();
  if (provider === "stub") {
    return stubRagEmbedder;
  }
  if (provider === "vertex") {
    const vertexConfig = readVertexRagEmbedderConfigFromEnv();
    if (!vertexConfig) {
      throw new Error(
        "RAG_EMBED_PROVIDER=vertex but VERTEX_PROJECT_ID is not set"
      );
    }
    return createVertexRagEmbedder(vertexConfig);
  }
  throw new Error(`Unsupported RAG_EMBED_PROVIDER: ${provider}`);
})();

// Query-side embedder for RAG retrieval at draft generation. Vertex
// recommends asymmetric task types, so use RETRIEVAL_QUERY here while the
// indexing path above uses RETRIEVAL_DOCUMENT. Stub provider: reuse the
// same stub (deterministic hash; symmetry doesn't matter).
const ragQueryEmbedder: RagEmbedFn = (() => {
  const provider = (process.env.RAG_EMBED_PROVIDER ?? "stub").toLowerCase();
  if (provider === "stub") {
    return stubRagEmbedder;
  }
  if (provider === "vertex") {
    const vertexConfig = readVertexRagEmbedderConfigFromEnv();
    if (!vertexConfig) {
      throw new Error(
        "RAG_EMBED_PROVIDER=vertex but VERTEX_PROJECT_ID is not set"
      );
    }
    return createVertexRagQueryEmbedder(vertexConfig);
  }
  throw new Error(`Unsupported RAG_EMBED_PROVIDER: ${provider}`);
})();

// Telegram notifications side channel. When TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID are unset the dispatcher is null and the handler
// emits `telegram_notification_skipped` with reason
// `telegram_dispatcher_not_configured`, completing the job cleanly so
// retry budget isn't burned in environments without a bot configured.
const telegramRuntime = readTelegramRuntimeConfigFromEnv();
const telegramDispatcher: TelegramNotificationDispatcher | null = telegramRuntime
  ? (() => {
      const client = createTelegramClient({ botToken: telegramRuntime.botToken });
      return (input) => client.send(input);
    })()
  : null;
const telegramDefaultChatId = telegramRuntime?.defaultChatId ?? null;

let shuttingDown = false;
let lastHeartbeatAt = 0;

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

async function main() {
  const schema = await assertSchemaCompatibility();
  log("info", "schema_compatible", {
    expectedVersion: schema.expectedVersion,
    appliedVersion: schema.appliedVersion
  });
  log("info", "worker_started", { pollIntervalMs, leaseSeconds, heartbeatIntervalMs, workerPools, runOnce });
  await maybeRecordHeartbeat(true);

  // Background cron suite: policy resurfacing, stale recovery, watchdogs, event
  // retention, and cost rollups. Each helper dedupes by singleton key/bucket,
  // so startup can call this idempotently without an external scheduler.
  if (workerPools.includes("background")) {
    const scheduled = await ensureBackgroundCronsScheduled({
      availableAt: new Date()
    });
    log("info", "background_crons_bootstrap", scheduled);
    // T-026BT: re-arm recurring discovery ticks for campaigns whose recurrence
    // is active, so schedules survive a worker restart.
    const recurrence = await ensureActiveCampaignDiscoveryCronsScheduled();
    log("info", "campaign_discovery_crons_bootstrap", recurrence);
  }

  while (!shuttingDown) {
    await maybeRecordHeartbeat();
    const recoveredJobs = await recoverStaleJobs(workerId);
    if (recoveredJobs > 0) {
      log("warn", "stale_jobs_recovered", { count: recoveredJobs });
    }
    log("debug", "worker_poll", { workerPools });

    const job = await leaseNextJobFromPools();
    if (!job) {
      if (runOnce) {
        break;
      }
      await sleep(pollIntervalMs);
      continue;
    }

    await runJob(job);
    if (runOnce) {
      break;
    }
  }

  await recordWorkerHeartbeat({
    workerId,
    status: "stopped",
    metadataJson: { stoppedAt: new Date().toISOString() }
  });
  await closeDb();
  log("info", "worker_stopped");
}

async function leaseNextJobFromPools(): Promise<LeasedJob | null> {
  for (const workerPool of workerPools) {
    const job = await leaseNextJob(workerId, leaseSeconds, workerPool);
    if (job) {
      return job;
    }
  }

  return null;
}

async function runJob(job: LeasedJob) {
  return traceOperation({
    serviceName: "worker",
    name: "worker.runJob",
    kind: "consumer",
    correlationId: job.correlation_id,
    attributes: {
      jobId: job.id,
      jobType: job.job_type,
      attempt: job.attempts,
      workerId
    }
  }, () => runJobWithinTrace(job));
}

async function runJobWithinTrace(job: LeasedJob) {
  log("info", "job_leased", {
    jobId: job.id,
    jobType: job.job_type,
    attempt: job.attempts,
    correlationId: job.correlation_id
  });
  const run = await startJobRun(job, workerId);

  try {
    switch (job.job_type) {
      case "job.start_campaign_expansion": {
        const campaignId = readString(job.payload_json, "campaignId");
        await completeCampaignExpansionJob({
          job,
          runId: run.id,
          workerId,
          campaignId
        });
        break;
      }

      case "job.process_webhook_event": {
        const webhookEventId = readString(job.payload_json, "webhookEventId");
        await completeWebhookProcessingJob({
          job,
          runId: run.id,
          workerId,
          webhookEventId
        });
        break;
      }

      case "job.generate_cold_draft": {
        const organizationId = readString(job.payload_json, "organizationId");
        const operatorBrief = readString(job.payload_json, "operatorBrief");
        const campaignId = readOptionalString(job.payload_json, "campaignId");
        const threadId = readOptionalString(job.payload_json, "threadId");
        const contactId = readOptionalString(job.payload_json, "contactId");
        await completeGenerateDraftJob({
          job,
          runId: run.id,
          workerId,
          organizationId,
          operatorBrief,
          ...(campaignId ? { campaignId } : {}),
          ...(threadId ? { threadId } : {}),
          ...(contactId ? { contactId } : {}),
          dispatcher: agentDispatcher,
          ragQueryEmbedder
        });
        break;
      }

      case "job.generate_warm_draft": {
        const threadId = readString(job.payload_json, "threadId");
        const organizationId = readString(job.payload_json, "organizationId");
        const replyIntent = readString(job.payload_json, "replyIntent");
        const latestInboundMessageId = readString(job.payload_json, "latestInboundMessageId");
        const contactId = readOptionalString(job.payload_json, "contactId");
        await completeGenerateWarmDraftJob({
          job,
          runId: run.id,
          workerId,
          threadId,
          organizationId,
          replyIntent,
          latestInboundMessageId,
          ...(contactId ? { contactId } : {}),
          dispatcher: agentDispatcher,
          ragQueryEmbedder
        });
        break;
      }

      case "job.revise_draft": {
        const draftId = readString(job.payload_json, "draftId");
        const expectedVersionRaw = job.payload_json["expectedVersion"];
        if (typeof expectedVersionRaw !== "number" || !Number.isInteger(expectedVersionRaw)) {
          throw new Error("Missing integer payload field: expectedVersion");
        }
        const operatorFeedback = readString(job.payload_json, "operatorFeedback");
        const organizationId = readString(job.payload_json, "organizationId");
        await completeReviseDraftJob({
          job,
          runId: run.id,
          workerId,
          draftId,
          expectedVersion: expectedVersionRaw,
          organizationId,
          operatorFeedback,
          dispatcher: agentDispatcher
        });
        break;
      }

      case "job.revalidate_draft_claims": {
        const draftId = readString(job.payload_json, "draftId");
        const expectedVersionRaw = job.payload_json["expectedVersion"];
        if (typeof expectedVersionRaw !== "number" || !Number.isInteger(expectedVersionRaw)) {
          throw new Error("Missing integer payload field: expectedVersion");
        }
        const organizationId = readString(job.payload_json, "organizationId");
        await completeRevalidateDraftClaimsJob({
          job,
          runId: run.id,
          workerId,
          draftId,
          expectedVersion: expectedVersionRaw,
          organizationId,
          dispatcher: agentDispatcher
        });
        break;
      }

      case "job.refresh_research_snapshot": {
        const organizationId = readString(job.payload_json, "organizationId");
        const prompt = readString(job.payload_json, "prompt");
        await completeRefreshResearchSnapshotJob({
          job,
          runId: run.id,
          workerId,
          organizationId,
          prompt,
          dispatcher: agentDispatcher
        });
        break;
      }

      case "job.discover_contacts": {
        const organizationId = readString(job.payload_json, "organizationId");
        const prompt = readString(job.payload_json, "prompt");
        await completeDiscoverContactsJob({
          job,
          runId: run.id,
          workerId,
          organizationId,
          prompt,
          dispatcher: agentDispatcher
        });
        break;
      }

      case "job.run_campaign_discovery": {
        const campaignId = readString(job.payload_json, "campaignId");
        const runCap = readOptionalNumber(job.payload_json, "runCap");
        const cooldownBetweenDiscoverySeconds = readOptionalNumber(
          job.payload_json,
          "cooldownBetweenDiscoverySeconds"
        );
        await completeRunCampaignDiscoveryJob({
          job,
          runId: run.id,
          workerId,
          campaignId,
          ...(runCap !== undefined ? { runCap } : {}),
          ...(cooldownBetweenDiscoverySeconds !== undefined ? { cooldownBetweenDiscoverySeconds } : {}),
          dispatcher: agentDispatcher
        });
        break;
      }

      case "job.classify_reply": {
        const inboundMessageId = readString(job.payload_json, "inboundMessageId");
        await completeClassifyReplyJob({
          job,
          runId: run.id,
          workerId,
          inboundMessageId,
          dispatcher: agentDispatcher
        });
        break;
      }

      case "job.research_more": {
        const organizationId = readString(job.payload_json, "organizationId");
        const draftId = readOptionalString(job.payload_json, "draftId") ?? null;
        const operatorNote = readOptionalString(job.payload_json, "operatorNote") ?? null;
        const currentSnapshotId =
          readOptionalString(job.payload_json, "currentSnapshotId") ?? null;
        const qualityGateRetryCount =
          readOptionalNumber(job.payload_json, "qualityGateRetryCount") ?? 0;
        const claimIdsRaw = job.payload_json["unsupportedClaimIds"];
        if (!Array.isArray(claimIdsRaw)) {
          throw new Error("Missing array payload field: unsupportedClaimIds");
        }
        const unsupportedClaimIds = claimIdsRaw.filter(
          (v): v is string => typeof v === "string"
        );
        const claimTextsRaw = job.payload_json["unsupportedClaimTexts"];
        const unsupportedClaimTexts = Array.isArray(claimTextsRaw)
          ? claimTextsRaw.flatMap((entry) => {
              if (!entry || typeof entry !== "object") return [];
              const id = (entry as Record<string, unknown>)["id"];
              const text = (entry as Record<string, unknown>)["text"];
              if (typeof id !== "string" || typeof text !== "string") return [];
              return [{ id, text }];
            })
          : [];
        await completeResearchMoreJob({
          job,
          runId: run.id,
          workerId,
          organizationId,
          draftId,
          unsupportedClaimIds,
          unsupportedClaimTexts,
          operatorNote,
          currentSnapshotId,
          qualityGateRetryCount,
          dispatcher: agentDispatcher
        });
        break;
      }

      case "job.send_email": {
        const outboundMessageId = readString(job.payload_json, "outboundMessageId");
        await completeSendEmailJob({
          job,
          runId: run.id,
          workerId,
          outboundMessageId,
          dispatcher: sendEmailDispatcher
        });
        break;
      }

      case "job.index_rag_document": {
        await completeIndexRagDocumentJob({
          job,
          runId: run.id,
          workerId,
          embedder: ragEmbedder
        });
        break;
      }

      case "job.send_telegram_notification": {
        await completeSendTelegramNotificationJob({
          job,
          runId: run.id,
          workerId,
          dispatcher: telegramDispatcher,
          defaultChatId: telegramDefaultChatId
        });
        break;
      }

      case "job.resurface_policy_states": {
        const result = await completeResurfacePolicyStatesJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "policy_states_resurfaced", {
          jobId: job.id,
          scanned: result.scanned,
          resurfaced: result.resurfaced,
          cooldownExpired: result.cooldownExpired,
          followupEligible: result.followupEligible
        });
        break;
      }

      case "job.cron_recover_stale_jobs": {
        const result = await completeRecoverStaleJobsCronJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "stale_jobs_recovery_cron_completed", {
          jobId: job.id,
          recoveredJobs: result.recoveredJobs
        });
        break;
      }

      case "job.cron_worker_heartbeat_watchdog": {
        const result = await completeWorkerHeartbeatWatchdogJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "worker_heartbeat_watchdog_completed", {
          jobId: job.id,
          checked: result.checked,
          unhealthy: result.unhealthy,
          notified: result.notified,
          bucket: result.bucket
        });
        break;
      }

      case "job.cron_queue_depth_watchdog": {
        const result = await completeQueueDepthWatchdogJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "queue_depth_watchdog_completed", {
          jobId: job.id,
          checked: result.checked,
          detected: result.detected,
          notified: result.notified,
          bucket: result.bucket
        });
        break;
      }

      case "job.cron_rotate_event_log": {
        const result = await completeRotateEventLogCronJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "event_log_rotation_cron_completed", {
          jobId: job.id,
          archivedRows: result.archivedRows,
          policyReferencesCleared: result.policyReferencesCleared,
          cutoff: result.cutoff
        });
        break;
      }

      case "job.cron_rollup_agent_costs": {
        const result = await completeRollupAgentCostsCronJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "agent_cost_rollup_cron_completed", {
          jobId: job.id,
          usageDay: result.usageDay,
          rolledUpRows: result.rolledUpRows,
          totalEstimatedUsd: result.totalEstimatedUsd,
          spikeAlerts: result.spikeAlerts
        });
        break;
      }

      case "job.cron_campaign_discovery": {
        const result = await completeCampaignDiscoveryCronJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "campaign_discovery_cron_completed", {
          jobId: job.id,
          triggered: result.triggered,
          rearmed: result.rearmed
        });
        break;
      }

      case "job.cron_reconcile_campaign_discovery": {
        const result = await completeReconcileCampaignDiscoveryCronJob({
          job,
          runId: run.id,
          workerId
        });
        log("info", "campaign_discovery_reconcile_completed", {
          jobId: job.id,
          armed: result.armed
        });
        break;
      }

      default:
        throw new Error(`Unsupported job type: ${job.job_type}`);
    }
    log("info", "job_succeeded", { jobId: job.id, jobType: job.job_type, runId: run.id });
  } catch (error) {
    await failJob({ job, runId: run.id, workerId, error });
    log("error", "job_failed", {
      jobId: job.id,
      jobType: job.job_type,
      runId: run.id,
      ...serializeError(error)
    });
  }
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing string payload field: ${key}`);
  }
  return value;
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

function readOptionalNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeRecordHeartbeat(force = false) {
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < heartbeatIntervalMs) {
    return;
  }

  await recordWorkerHeartbeat({
    workerId,
    status: "running",
    metadataJson: {
      pollIntervalMs,
      leaseSeconds,
      workerPools,
      runOnce
    }
  });
  lastHeartbeatAt = now;
}

function log(level: WorkerLogLevel, event: string, fields: Record<string, unknown> = {}) {
  logger[level]({
    event,
    workerId,
    ...fields
  });
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

main().catch(async (error) => {
  log("error", "worker_crashed", serializeError(error));
  await recordWorkerHeartbeat({
    workerId,
    status: "failed",
    metadataJson: {
      failedAt: new Date().toISOString(),
      ...serializeError(error)
    }
  }).catch((heartbeatError) => {
    log("error", "worker_heartbeat_failed", serializeError(heartbeatError));
  });
  await closeDb();
  process.exit(1);
});
