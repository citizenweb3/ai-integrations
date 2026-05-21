import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  approveDraftForSendCommand,
  campaigns,
  closeDb,
  commands,
  completeCampaignExpansionJob,
  contacts,
  createStartCampaignCommand,
  draftClaims,
  drafts,
  draftVersions,
  eventLog,
  generateDraftCommand,
  getDb,
  jobs,
  jobRuns,
  organizations,
  systemState,
  updateCampaignScopeCommand,
  workItems,
  type LeasedJob
} from "../src";

after(async () => {
  await closeDb();
});

test("campaign expansion requires complete scope before activating discovery", async (t) => {
  const db = getDb();
  await clearT026EArtifacts();
  t.after(clearT026EArtifacts);

  const suffix = randomUUID();
  const created = await createStartCampaignCommand({
    payload: {
      name: `t026e-incomplete-${suffix}`,
      objective: "Book qualified conversations with regulated operators.",
      targetSegments: [],
      forbiddenClaims: [],
      discoverySourceHints: [],
      discoveryExclusions: [],
      allowedRegions: [],
      maxOrganizationsToDiscover: 25,
      maxConcurrentEnrichments: 3,
      maxConcurrentDrafts: 5,
      maxOpenDraftReviews: 25,
      cooldownBetweenDiscoverySeconds: 3600,
      idempotencyKey: `t026e-start-incomplete-${suffix}`
    }
  });

  await runExpansionJobForCampaign(created.campaign.id);

  const [incompleteCampaign] = await db
    .select({
      status: campaigns.status,
      discoveryScopeVersion: campaigns.discoveryScopeVersion
    })
    .from(campaigns)
    .where(eq(campaigns.id, created.campaign.id))
    .limit(1);
  assert.deepEqual(incompleteCampaign, { status: "drafting_scope", discoveryScopeVersion: 1 });

  const [scopeWorkItem] = await db
    .select({
      status: workItems.status,
      reasonCode: workItems.reasonCode,
      summary: workItems.summary
    })
    .from(workItems)
    .where(eq(workItems.dedupeKey, `campaign_scope_incomplete:${created.campaign.id}`))
    .limit(1);
  assert.equal(scopeWorkItem?.status, "open");
  assert.equal(scopeWorkItem?.reasonCode, "campaign_scope_incomplete");
  assert.match(scopeWorkItem?.summary ?? "", /offer_summary/);
  assert.match(scopeWorkItem?.summary ?? "", /desired_cta/);
  assert.match(scopeWorkItem?.summary ?? "", /target_segments/);

  const discoveryJobsBeforeReady = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(
      eq(jobs.jobType, "job.run_campaign_discovery"),
      eq(jobs.targetEntityId, created.campaign.id)
    ));
  assert.equal(discoveryJobsBeforeReady.length, 0);

  const updated = await updateCampaignScopeCommand({
    payload: {
      campaignId: created.campaign.id,
      name: `t026e-ready-${suffix}`,
      objective: "Book qualified conversations with regulated operators.",
      offerSummary: "A verified outbound offer for compliance workflow automation.",
      desiredCta: "Ask for a 20 minute workflow review.",
      targetSegments: ["Regulated fintech", "Compliance operations"],
      forbiddenClaims: ["Do not promise guaranteed cost savings"],
      discoverySourceHints: ["Use partner directories"],
      discoveryExclusions: ["Exclude agencies"],
      allowedRegions: ["US"],
      maxOrganizationsToDiscover: 12,
      maxConcurrentEnrichments: 4,
      maxConcurrentDrafts: 6,
      maxOpenDraftReviews: 18,
      cooldownBetweenDiscoverySeconds: 1800,
      idempotencyKey: `t026e-update-ready-${suffix}`
    }
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) assert.fail(updated.failure.message);
  assert.equal(updated.campaign.discoveryScopeVersion, 2);
  assert.equal(updated.campaign.offerSummary, "A verified outbound offer for compliance workflow automation.");
  assert.deepEqual(updated.campaign.forbiddenClaims, ["Do not promise guaranteed cost savings"]);

  await runExpansionJobForCampaign(created.campaign.id);

  const [readyCampaign] = await db
    .select({
      status: campaigns.status,
      maxConcurrentEnrichments: campaigns.maxConcurrentEnrichments,
      maxConcurrentDrafts: campaigns.maxConcurrentDrafts,
      maxOpenDraftReviews: campaigns.maxOpenDraftReviews
    })
    .from(campaigns)
    .where(eq(campaigns.id, created.campaign.id))
    .limit(1);
  assert.deepEqual(readyCampaign, {
    status: "active",
    maxConcurrentEnrichments: 4,
    maxConcurrentDrafts: 6,
    maxOpenDraftReviews: 18
  });

  const [resolvedWorkItem] = await db
    .select({ status: workItems.status, resolvedAt: workItems.resolvedAt })
    .from(workItems)
    .where(eq(workItems.dedupeKey, `campaign_scope_incomplete:${created.campaign.id}`))
    .limit(1);
  assert.equal(resolvedWorkItem?.status, "resolved");
  assert.ok(resolvedWorkItem?.resolvedAt);

  const [discoveryJob] = await db
    .select({
      payloadJson: jobs.payloadJson,
      workerPool: jobs.workerPool
    })
    .from(jobs)
    .where(and(
      eq(jobs.jobType, "job.run_campaign_discovery"),
      eq(jobs.targetEntityId, created.campaign.id)
    ))
    .limit(1);
  assert.equal(discoveryJob?.workerPool, "background");
  assert.equal(discoveryJob?.payloadJson["runCap"], 12);
  assert.equal(discoveryJob?.payloadJson["discoveryScopeVersion"], 2);
  assert.equal(discoveryJob?.payloadJson["cooldownBetweenDiscoverySeconds"], 1800);

  const rejectedUpdate = await updateCampaignScopeCommand({
    payload: {
      campaignId: created.campaign.id,
      objective: "This active campaign should not be editable.",
      idempotencyKey: `t026e-update-active-${suffix}`
    }
  });
  assert.equal(rejectedUpdate.ok, false);
  if (rejectedUpdate.ok) assert.fail("active campaign update should fail");
  assert.equal(rejectedUpdate.failure.code, "campaign_not_editable");
});

test("draft generation and approval hard-block non-active campaign scope", async (t) => {
  const db = getDb();
  await clearT026EArtifacts();
  t.after(clearT026EArtifacts);
  await db.delete(systemState).where(eq(systemState.key, "sends_paused"));

  const suffix = randomUUID();
  const email = `t026e-${suffix}@example.com`;
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t026e-org-${suffix}`,
      domain: `t026e-${suffix}.example`
    })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t026e-drafting-${suffix}`,
      status: "drafting_scope",
      objective: "This campaign is still being scoped.",
      offerSummary: "Offer is present but the status is not active.",
      desiredCta: "Book a scope review.",
      targetSegments: ["T026E"]
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({
      organizationId: organization.id,
      email,
      fullName: "T026E Recipient"
    })
    .returning({ id: contacts.id });
  assert.ok(contact);

  const draftRequest = await generateDraftCommand({
    payload: {
      organizationId: organization.id,
      contactId: contact.id,
      campaignId: campaign.id,
      operatorBrief: "Write a cold outbound draft."
    }
  });
  assert.equal(draftRequest.ok, false);
  if (draftRequest.ok) assert.fail("draft generation should fail for drafting_scope campaign");
  assert.equal(draftRequest.failure.code, "campaign_not_active");

  const subject = `T026E subject ${suffix}`;
  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: campaign.id,
      contactId: contact.id,
      subject,
      body: "T026E body with a supported claim.",
      status: "draft",
      version: 1,
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject,
    body: "T026E body with a supported claim.",
    bodyHash: `t026e-${suffix}`,
    claimsValidatedVersion: 1,
    source: "agent_generated"
  });
  await db.insert(draftClaims).values({
    draftId: draft.id,
    claimText: "T026E supported claim.",
    safety: "supported"
  });

  const approval = await approveDraftForSendCommand({
    payload: { draftId: draft.id, draftVersion: 1 },
    fromEmail: "sender@example.com"
  });
  assert.equal(approval.ok, false);
  if (approval.ok) assert.fail("approval should fail for drafting_scope campaign");
  assert.equal(approval.failure.code, "campaign_not_active");
  assert.equal(approval.failures?.some((failure) => failure.code === "campaign_not_active"), true);
});

async function runExpansionJobForCampaign(campaignId: string): Promise<void> {
  const db = getDb();
  const workerId = `t026e-worker-${randomUUID()}`;
  const [queuedJob] = await db
    .select()
    .from(jobs)
    .where(and(
      eq(jobs.jobType, "job.start_campaign_expansion"),
      eq(jobs.targetEntityId, campaignId),
      eq(jobs.status, "queued")
    ))
    .limit(1);
  assert.ok(queuedJob);

  const [runningJob] = await db
    .update(jobs)
    .set({
      status: "running",
      attempts: sql`${jobs.attempts} + 1`,
      leasedBy: workerId,
      leasedUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date()
    })
    .where(eq(jobs.id, queuedJob.id))
    .returning({ attempts: jobs.attempts });
  assert.ok(runningJob);

  const [run] = await db
    .insert(jobRuns)
    .values({
      jobId: queuedJob.id,
      status: "running",
      workerId,
      attempt: runningJob.attempts
    })
    .returning({ id: jobRuns.id });
  assert.ok(run);

  const leasedJob: LeasedJob = {
    id: queuedJob.id,
    job_type: "job.start_campaign_expansion",
    command_id: queuedJob.commandId,
    payload_json: queuedJob.payloadJson,
    attempts: runningJob.attempts,
    max_attempts: queuedJob.maxAttempts,
    correlation_id: queuedJob.correlationId
  };

  await completeCampaignExpansionJob({
    job: leasedJob,
    runId: run.id,
    workerId,
    campaignId
  });
}

async function clearT026EArtifacts(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    DELETE FROM event_log
    WHERE payload_json::text LIKE '%t026e-%'
       OR entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
       OR entity_id IN (SELECT id FROM organizations WHERE name LIKE 't026e-%')
       OR entity_id IN (SELECT id FROM contacts WHERE email LIKE 't026e-%')
       OR entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
       OR job_id IN (
         SELECT id FROM jobs
         WHERE target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
            OR target_entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
            OR payload_json::text LIKE '%t026e-%'
       )
       OR command_id IN (
         SELECT id FROM commands
         WHERE payload_json::text LIKE '%t026e-%'
            OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
            OR target_entity_id IN (SELECT id FROM organizations WHERE name LIKE 't026e-%')
            OR target_entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
       )
  `);
  await db.execute(sql`
    DELETE FROM work_items
    WHERE campaign_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
       OR draft_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
       OR source_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
       OR source_entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
  `);
  await db.execute(sql`
    DELETE FROM job_runs
    WHERE job_id IN (
      SELECT id FROM jobs
      WHERE target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
         OR target_entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
         OR payload_json::text LIKE '%t026e-%'
    )
  `);
  await db.execute(sql`
    DELETE FROM jobs
    WHERE target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
       OR target_entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
       OR payload_json::text LIKE '%t026e-%'
       OR command_id IN (
         SELECT id FROM commands
         WHERE payload_json::text LIKE '%t026e-%'
            OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
            OR target_entity_id IN (SELECT id FROM organizations WHERE name LIKE 't026e-%')
            OR target_entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
       )
  `);
  await db.execute(sql`
    DELETE FROM commands
    WHERE payload_json::text LIKE '%t026e-%'
       OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026e-%')
       OR target_entity_id IN (SELECT id FROM organizations WHERE name LIKE 't026e-%')
       OR target_entity_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
  `);
  await db.execute(sql`
    DELETE FROM draft_claims
    WHERE draft_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
  `);
  await db.execute(sql`
    DELETE FROM draft_versions
    WHERE draft_id IN (SELECT id FROM drafts WHERE subject LIKE 'T026E%')
  `);
  await db.execute(sql`DELETE FROM drafts WHERE subject LIKE 'T026E%'`);
  await db.execute(sql`DELETE FROM contacts WHERE email LIKE 't026e-%'`);
  await db.execute(sql`DELETE FROM campaigns WHERE name LIKE 't026e-%'`);
  await db.execute(sql`DELETE FROM organizations WHERE name LIKE 't026e-%'`);
}
