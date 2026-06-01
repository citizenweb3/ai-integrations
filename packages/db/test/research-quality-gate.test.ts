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
  ragChunks,
  ragDocuments,
  ragEmbeddings,
  researchContactCandidates,
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

  // T-026BG: the gate returned sufficient=false, so the snapshot must NOT be
  // promoted — it stays `draft` and emits no published event.
  const unpromoted = await db
    .select({ id: researchSnapshots.id, status: researchSnapshots.status })
    .from(researchSnapshots)
    .where(eq(researchSnapshots.organizationId, organization.id));
  assert.equal(unpromoted.length, 1);
  assert.equal(unpromoted[0]!.status, "draft", "insufficient gate must leave snapshot draft");
  const noPublish = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(and(
      eq(eventLog.eventType, "research_snapshot_published"),
      eq(eventLog.entityId, unpromoted[0]!.id)
    ));
  assert.equal(noPublish.length, 0, "no published event when gate insufficient");
});

test("research snapshot job routes citation primary URLs for redirect evidence", async (t) => {
  const db = getDb();
  const suffix = randomUUID();
  await clearResearchQualityGateArtifacts(suffix);
  t.after(() => clearResearchQualityGateArtifacts(suffix));

  const domain = `t-quality-gate-${suffix}.example`;
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t-quality-gate-${suffix}`,
      domain
    })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const running = await createRunningResearchSnapshotJob({
    organizationId: organization.id,
    prompt: "Refresh citation-backed research."
  });

  const quoteText = "T quality gate citation evidence for procurement automation.";
  const finalText = JSON.stringify({
    summary: "Citation-backed public snapshot.",
    facts: [
      {
        claim: "The organization documents procurement automation.",
        category: "company",
        confidence: "medium",
        evidence: [
          {
            sourceUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ-citation",
            sourceType: "search_result",
            quoteText,
            supportType: "supports"
          }
        ]
      }
    ],
    questions: [],
    contactCandidates: [
      {
        fullName: "Redirect Contact",
        email: null,
        role: "VP Partnerships",
        source: "search_result",
        evidenceUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ-contact",
        sourceRefs: [
          {
            url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ-contact-ref",
            title: "Redirect contact ref",
            snippet: "Redirect Contact leads partnerships."
          }
        ],
        confidence: "medium",
        notes: "Smoke candidate with redirect-only source refs."
      }
    ]
  }, null, 2);
  const quoteStart = finalText.indexOf(quoteText);
  assert.notEqual(quoteStart, -1);
  const primaryUrl = `https://${domain}/research/procurement`;

  const dispatcher: AgentStageDispatcher = async function* (request) {
    if (request.stage === "research_snapshot") {
      yield {
        eventType: "final_response",
        payloadJson: {
          text: finalText,
          citations: [
            {
              uri: primaryUrl,
              startIndex: quoteStart,
              endIndex: quoteStart + quoteText.length
            }
          ]
        }
      };
      return;
    }
    if (request.stage === "research_quality_gate") {
      assert.ok(request.prompt.includes(primaryUrl));
      assert.doesNotMatch(request.prompt, /vertexaisearch\.cloud\.google\.com/);
      yield {
        eventType: "final_response",
        payloadJson: {
          text: JSON.stringify({
            sufficient: true,
            confidence: "high",
            reasons: ["Primary URL was recovered from citation metadata."],
            retryQueries: [],
            missing: [],
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
    prompt: "Refresh citation-backed research.",
    dispatcher
  });

  const evidenceRows = await db
    .select({
      sourceUrl: researchEvidence.sourceUrl,
      quoteText: researchEvidence.quoteText
    })
    .from(researchSnapshots)
    .innerJoin(researchFacts, eq(researchFacts.snapshotId, researchSnapshots.id))
    .innerJoin(researchFactEvidence, eq(researchFactEvidence.researchFactId, researchFacts.id))
    .innerJoin(researchEvidence, eq(researchEvidence.id, researchFactEvidence.researchEvidenceId))
    .where(eq(researchSnapshots.organizationId, organization.id));

  assert.deepEqual(evidenceRows, [
    {
      sourceUrl: primaryUrl,
      quoteText
    }
  ]);

  const candidates = await db
    .select({
      evidenceUrl: researchContactCandidates.evidenceUrl,
      sourceRefs: researchContactCandidates.sourceRefs
    })
    .from(researchContactCandidates)
    .where(eq(researchContactCandidates.organizationId, organization.id));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.evidenceUrl, null);
  assert.deepEqual(candidates[0]!.sourceRefs, []);

  const snapshotArtifacts = await db
    .select({ payloadJson: agentRunArtifacts.payloadJson })
    .from(agentRunArtifacts)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunArtifacts.agentRunId))
    .where(and(
      eq(agentRuns.jobId, running.job.id),
      eq(agentRunArtifacts.artifactType, "research_snapshot_output")
    ));
  assert.equal(snapshotArtifacts.length, 1);
  assert.equal(Array.isArray((snapshotArtifacts[0]!.payloadJson as Record<string, unknown>)["citations"]), true);

  // T-026BG: the gate returned sufficient=true, so the snapshot must be
  // promoted to `published` and a `research_snapshot_published` event emitted.
  const promotedSnapshots = await db
    .select({ id: researchSnapshots.id, status: researchSnapshots.status })
    .from(researchSnapshots)
    .where(eq(researchSnapshots.organizationId, organization.id));
  assert.equal(promotedSnapshots.length, 1);
  assert.equal(promotedSnapshots[0]!.status, "published");
  const publishedEvents = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(and(
      eq(eventLog.eventType, "research_snapshot_published"),
      eq(eventLog.entityId, promotedSnapshots[0]!.id)
    ));
  assert.equal(publishedEvents.length, 1, "one research_snapshot_published event");
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

  if (orgIds.length > 0) {
    await db.delete(researchContactCandidates).where(inArray(researchContactCandidates.organizationId, orgIds));
  }
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
  // RAG corpus indexing produces rag_documents tied to the org (chunks +
  // embeddings hang off the document). They must go before the org or the
  // organization delete trips rag_documents_organization_id_fkey.
  const ragDocRows = await db
    .select({ id: ragDocuments.id })
    .from(ragDocuments)
    .where(inArray(ragDocuments.organizationId, orgIds));
  const ragDocIds = ragDocRows.map((row) => row.id);
  if (ragDocIds.length > 0) {
    const ragChunkRows = await db
      .select({ id: ragChunks.id })
      .from(ragChunks)
      .where(inArray(ragChunks.documentId, ragDocIds));
    const ragChunkIds = ragChunkRows.map((row) => row.id);
    if (ragChunkIds.length > 0) {
      await db.delete(ragEmbeddings).where(inArray(ragEmbeddings.chunkId, ragChunkIds));
      await db.delete(ragChunks).where(inArray(ragChunks.id, ragChunkIds));
    }
    await db.delete(ragDocuments).where(inArray(ragDocuments.id, ragDocIds));
  }
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
