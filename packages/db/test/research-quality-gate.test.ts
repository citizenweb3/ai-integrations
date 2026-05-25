import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  agentRunArtifacts,
  agentRunEvents,
  agentRuns,
  closeDb,
  completeRefreshResearchSnapshotJob,
  eventLog,
  getDb,
  jobRuns,
  jobs,
  organizations,
  researchEvidence,
  researchFactEvidence,
  researchFacts,
  researchSnapshots,
  type AgentStageDispatcher,
  type LeasedJob
} from "../src";

after(async () => {
  await closeDb();
});

test("research quality gate queues one follow-up research_more job when evidence is insufficient", async (t) => {
  const db = getDb();
  const suffix = randomUUID();
  await clearResearchQualityGateArtifacts(suffix);
  t.after(() => clearResearchQualityGateArtifacts(suffix));

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t-quality-gate-${suffix}`,
      domain: `t-quality-gate-${suffix}.example`
    })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const running = await createRunningResearchSnapshotJob({
    organizationId: organization.id,
    prompt: "Refresh sparse research."
  });
  const seenStages: string[] = [];
  const dispatcher: AgentStageDispatcher = async function* (request) {
    seenStages.push(request.stage);
    if (request.stage === "research_snapshot") {
      yield {
        eventType: "final_response",
        payloadJson: {
          text: JSON.stringify({
            summary: "Sparse public snapshot.",
            facts: [
              {
                claim: "The organization has a public website.",
                category: "company",
                confidence: "medium",
                evidence: [
                  {
                    sourceUrl: "https://example.com/about",
                    sourceType: "search_result",
                    quoteText: "About page.",
                    supportType: "supports"
                  }
                ]
              }
            ],
            questions: ["Who owns partnerships?"],
            contactCandidates: []
          })
        }
      };
      return;
    }
    if (request.stage === "research_quality_gate") {
      yield {
        eventType: "final_response",
        payloadJson: {
          text: JSON.stringify({
            sufficient: false,
            confidence: "high",
            reasons: ["Only one generic fact was found."],
            retryQueries: [
              `"${`t-quality-gate-${suffix}`}" partnerships`,
              `"${`t-quality-gate-${suffix}`}" founder`
            ],
            missing: ["named outreach target"],
            operatorReviewRecommended: false
          })
        }
      };
      return;
    }
    throw new Error(`unexpected stage ${request.stage}`);
  };

  await completeRefreshResearchSnapshotJob({
    ...running,
    organizationId: organization.id,
    prompt: "Refresh sparse research.",
    dispatcher
  });

  assert.deepEqual(seenStages, ["research_snapshot", "research_quality_gate"]);

  const [originalJob] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, running.job.id))
    .limit(1);
  assert.deepEqual(originalJob, { status: "succeeded" });

  const retryJobs = await db
    .select({
      id: jobs.id,
      payloadJson: jobs.payloadJson,
      status: jobs.status,
      jobType: jobs.jobType
    })
    .from(jobs)
    .where(and(
      eq(jobs.targetEntityId, organization.id),
      eq(jobs.jobType, "job.research_more"),
      eq(jobs.status, "queued")
    ));
  assert.equal(retryJobs.length, 1);
  const retryPayload = retryJobs[0]!.payloadJson as Record<string, unknown>;
  assert.equal(retryPayload["qualityGateRetryCount"], 1);
  assert.equal(retryPayload["organizationId"], organization.id);
  assert.equal(retryPayload["draftId"], null);
  assert.match(String(retryPayload["operatorNote"]), /Retry search queries/);
  assert.match(String(retryPayload["operatorNote"]), /partnerships/);

  const sourceRuns = await db
    .select({ stage: agentRuns.stage, status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.jobId, running.job.id));
  assert.deepEqual(
    sourceRuns.map((row) => `${row.stage}:${row.status}`).sort(),
    ["research_snapshot:succeeded"]
  );

  const gateRuns = await db
    .select({
      id: agentRuns.id,
      stage: agentRuns.stage,
      status: agentRuns.status,
      inputSnapshotJson: agentRuns.inputSnapshotJson
    })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.stage, "research_quality_gate"),
      eq(agentRuns.status, "succeeded"),
      sql`${agentRuns.inputSnapshotJson}->>'organizationId' = ${organization.id}`
    ));
  assert.deepEqual(
    gateRuns.map((row) => `${row.stage}:${row.status}`).sort(),
    ["research_quality_gate:succeeded"]
  );
  assert.equal(
    (gateRuns[0]!.inputSnapshotJson as Record<string, unknown>)["sourceJobId"],
    running.job.id
  );

  const [queuedEvent] = await db
    .select({ eventType: eventLog.eventType })
    .from(eventLog)
    .where(and(
      eq(eventLog.entityId, organization.id),
      eq(eventLog.eventType, "research_quality_gate_retry_queued")
    ))
    .limit(1);
  assert.deepEqual(queuedEvent, { eventType: "research_quality_gate_retry_queued" });
});

async function createRunningResearchSnapshotJob(input: {
  organizationId: string;
  prompt: string;
}): Promise<{ job: LeasedJob; runId: string; workerId: string }> {
  const db = getDb();
  const jobId = randomUUID();
  const runId = randomUUID();
  const workerId = `t-quality-gate-worker-${randomUUID()}`;
  const correlationId = randomUUID();
  const payloadJson = {
    organizationId: input.organizationId,
    prompt: input.prompt
  };

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.refresh_research_snapshot",
    status: "running",
    workerPool: "background",
    targetEntityType: "organization",
    targetEntityId: input.organizationId,
    payloadJson,
    leasedBy: workerId,
    leasedUntil: new Date(Date.now() + 60_000),
    attempts: 1,
    maxAttempts: 3,
    correlationId
  });

  await db.insert(jobRuns).values({
    id: runId,
    jobId,
    status: "running",
    workerId,
    attempt: 1
  });

  return {
    runId,
    workerId,
    job: {
      id: jobId,
      job_type: "job.refresh_research_snapshot",
      command_id: null,
      payload_json: payloadJson,
      attempts: 1,
      max_attempts: 3,
      correlation_id: correlationId
    }
  };
}

async function clearResearchQualityGateArtifacts(suffix: string) {
  const db = getDb();
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, `t-quality-gate-${suffix}`));
  const orgIds = orgRows.map((row) => row.id);
  if (orgIds.length === 0) return;

  const jobRows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.targetEntityId, orgIds));
  const jobIds = jobRows.map((row) => row.id);
  const agentRunRows = jobIds.length > 0
    ? await db.select({ id: agentRuns.id }).from(agentRuns).where(inArray(agentRuns.jobId, jobIds))
    : [];
  const detachedAgentRunRows: { id: string }[] = [];
  for (const orgId of orgIds) {
    const rows = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(sql`${agentRuns.inputSnapshotJson}->>'organizationId' = ${orgId}`);
    detachedAgentRunRows.push(...rows);
  }
  const agentRunIds = Array.from(new Set([
    ...agentRunRows.map((row) => row.id),
    ...detachedAgentRunRows.map((row) => row.id)
  ]));
  const snapshotRows = await db
    .select({ id: researchSnapshots.id })
    .from(researchSnapshots)
    .where(inArray(researchSnapshots.organizationId, orgIds));
  const snapshotIds = snapshotRows.map((row) => row.id);
  const factRows = snapshotIds.length > 0
    ? await db
        .select({ id: researchFacts.id })
        .from(researchFacts)
        .where(inArray(researchFacts.snapshotId, snapshotIds))
    : [];
  const factIds = factRows.map((row) => row.id);
  const evidenceRows = factIds.length > 0
    ? await db
        .select({ evidenceId: researchFactEvidence.researchEvidenceId })
        .from(researchFactEvidence)
        .where(inArray(researchFactEvidence.researchFactId, factIds))
    : [];
  const evidenceIds = evidenceRows.map((row) => row.evidenceId);

  if (agentRunIds.length > 0) {
    await db.delete(agentRunArtifacts).where(inArray(agentRunArtifacts.agentRunId, agentRunIds));
    await db.delete(agentRunEvents).where(inArray(agentRunEvents.agentRunId, agentRunIds));
    await db.delete(agentRuns).where(inArray(agentRuns.id, agentRunIds));
  }
  if (jobIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.jobId, jobIds));
    await db.delete(jobRuns).where(inArray(jobRuns.jobId, jobIds));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  }
  if (orgIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.entityId, orgIds));
  }
  if (snapshotIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.entityId, snapshotIds));
  }
  if (factIds.length > 0) {
    await db.delete(researchFactEvidence).where(inArray(researchFactEvidence.researchFactId, factIds));
    await db.delete(researchFacts).where(inArray(researchFacts.id, factIds));
  }
  if (evidenceIds.length > 0) {
    await db.delete(researchEvidence).where(inArray(researchEvidence.id, evidenceIds));
  }
  if (snapshotIds.length > 0) {
    await db.delete(researchSnapshots).where(inArray(researchSnapshots.id, snapshotIds));
  }
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
