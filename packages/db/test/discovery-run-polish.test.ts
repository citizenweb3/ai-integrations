import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  agentRunArtifacts,
  agentRunEvents,
  agentRuns,
  campaigns,
  closeDb,
  commands,
  completeRunCampaignDiscoveryJob,
  discoveryCandidates,
  eventLog,
  getDb,
  jobs,
  jobRuns,
  policyStateEntries,
  runCampaignDiscoveryCommand,
  type AgentStageDispatcher,
  type LeasedJob
} from "../src";

after(async () => {
  await closeDb();
});

test("runCampaignDiscoveryCommand gates inactive campaigns, cooldowns, and campaign run caps", async (t) => {
  const db = getDb();
  await clearT026CArtifacts();
  t.after(clearT026CArtifacts);

  const suffix = randomUUID();
  const [pausedCampaign] = await db
    .insert(campaigns)
    .values({
      name: `t026c-paused-${suffix}`,
      status: "paused",
      objective: "Paused campaigns should not run discovery.",
      targetSegments: ["T026C"]
    })
    .returning({ id: campaigns.id });
  assert.ok(pausedCampaign);

  const paused = await runCampaignDiscoveryCommand({
    payload: { campaignId: pausedCampaign.id }
  });
  assert.equal(paused.ok, false);
  if (paused.ok) assert.fail("paused campaign should fail");
  assert.equal(paused.failure.code, "campaign_not_active");

  const [coolingCampaign] = await db
    .insert(campaigns)
    .values({
      name: `t026c-cooling-${suffix}`,
      status: "active",
      objective: "Cooldown should block immediate reruns.",
      targetSegments: ["T026C"]
    })
    .returning({ id: campaigns.id });
  assert.ok(coolingCampaign);
  await db.insert(policyStateEntries).values({
    scopeType: "campaign",
    scopeId: coolingCampaign.id,
    stateType: "discovery_cooldown",
    status: "active",
    reasonCode: "campaign_discovery",
    reasonText: "T026C active cooldown",
    expiresAt: new Date(Date.now() + 60_000)
  });

  const cooling = await runCampaignDiscoveryCommand({
    payload: { campaignId: coolingCampaign.id }
  });
  assert.equal(cooling.ok, false);
  if (cooling.ok) assert.fail("cooling campaign should fail");
  assert.equal(cooling.failure.code, "discovery_cooldown_active");

  const [cappedCampaign] = await db
    .insert(campaigns)
    .values({
      name: `t026c-capped-${suffix}`,
      status: "active",
      objective: "Reached cap should not enqueue discovery.",
      targetSegments: ["T026C"],
      maxOrganizationsToDiscover: 1
    })
    .returning({ id: campaigns.id });
  assert.ok(cappedCampaign);
  await db.insert(discoveryCandidates).values({
    campaignId: cappedCampaign.id,
    proposedName: `t026c-capped-candidate-${suffix}`,
    domain: `t026c-capped-${suffix}.example`,
    sourceRefs: [{ url: "https://example.com/t026c-capped" }],
    status: "proposed"
  });

  const capped = await runCampaignDiscoveryCommand({
    payload: { campaignId: cappedCampaign.id }
  });
  assert.equal(capped.ok, false);
  if (capped.ok) assert.fail("capped campaign should fail");
  assert.equal(capped.failure.code, "discovery_cap_reached");

  const [capEvent] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(eq(eventLog.entityId, cappedCampaign.id))
    .limit(1);
  assert.equal(capEvent?.payloadJson["runCap"], 0);

  const [activeCampaign] = await db
    .insert(campaigns)
    .values({
      name: `t026c-active-${suffix}`,
      status: "active",
      objective: "Run cap should be derived from current non-terminal candidates.",
      targetSegments: ["T026C"],
      maxOrganizationsToDiscover: 2,
      cooldownBetweenDiscoverySeconds: 300,
      discoveryScopeVersion: 4
    })
    .returning({ id: campaigns.id });
  assert.ok(activeCampaign);
  await db.insert(discoveryCandidates).values({
    campaignId: activeCampaign.id,
    proposedName: `t026c-existing-${suffix}`,
    domain: `t026c-existing-${suffix}.example`,
    sourceRefs: [{ url: "https://example.com/t026c-existing" }],
    status: "needs_review"
  });

  const accepted = await runCampaignDiscoveryCommand({
    payload: { campaignId: activeCampaign.id }
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) assert.fail(accepted.failure.message);
  assert.equal(accepted.job.payloadJson["runCap"], 1);
  assert.equal(accepted.job.payloadJson["discoveryScopeVersion"], 4);
  assert.equal(accepted.job.payloadJson["cooldownBetweenDiscoverySeconds"], 300);
  assert.equal("additionalGuidance" in accepted.job.payloadJson, false);
  assert.match(accepted.idempotencyKey, /scope_v4/);

  await db.insert(policyStateEntries).values({
    scopeType: "campaign",
    scopeId: activeCampaign.id,
    stateType: "discovery_cooldown",
    status: "active",
    reasonCode: "campaign_discovery",
    reasonText: "T026C active retry cooldown",
    expiresAt: new Date(Date.now() + 60_000)
  });
  const retry = await runCampaignDiscoveryCommand({
    payload: {
      campaignId: activeCampaign.id,
      idempotencyKey: accepted.idempotencyKey
    }
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) assert.fail(retry.failure.message);
  assert.equal(retry.deduplicated, true);
  assert.equal(retry.job.id, accepted.job.id);
});

test("campaign discovery uses persistent hints, stops at run cap, and writes cooldown state", async (t) => {
  const db = getDb();
  await clearT026CArtifacts();
  t.after(clearT026CArtifacts);

  const suffix = randomUUID();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t026c-prompt-${suffix}`,
      status: "active",
      objective: "Find stable B2B SaaS targets.",
      targetSegments: ["Regulated fintech"],
      discoverySourceHints: ["Use partner directories before generic search"],
      discoveryExclusions: ["Exclude agencies"],
      allowedRegions: ["US", "CA"],
      cooldownBetweenDiscoverySeconds: 30
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const running = await insertRunningDiscoveryJob(campaign.id, {
    runCap: 1,
    cooldownBetweenDiscoverySeconds: 30
  });
  let capturedPrompt = "";
  const dispatcher: AgentStageDispatcher = async function* ({ prompt }) {
    capturedPrompt = prompt;
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({
          candidates: [
            {
              proposedName: `t026c-cap-kept-${suffix}`,
              domain: `t026c-kept-${suffix}.example`,
              sourceRefs: [{ url: "https://example.com/t026c-kept" }]
            },
            {
              proposedName: `t026c-cap-dropped-${suffix}`,
              domain: `t026c-dropped-${suffix}.example`,
              sourceRefs: [{ url: "https://example.com/t026c-dropped" }]
            }
          ]
        })
      }
    };
  };

  await completeRunCampaignDiscoveryJob({
    ...running,
    campaignId: campaign.id,
    runCap: 1,
    cooldownBetweenDiscoverySeconds: 30,
    dispatcher
  });

  assert.match(capturedPrompt, /<persistent_hints>/);
  assert.match(capturedPrompt, /Use partner directories before generic search/);
  assert.match(capturedPrompt, /Exclude agencies/);
  assert.match(capturedPrompt, /US/);
  assert.doesNotMatch(capturedPrompt, /<additional_guidance>/);

  const candidates = await db
    .select({ proposedName: discoveryCandidates.proposedName })
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.campaignId, campaign.id));
  assert.deepEqual(candidates.map((row) => row.proposedName), [`t026c-cap-kept-${suffix}`]);

  const [capEvent] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`
      ${eventLog.eventType} = 'campaign_discovery_cap_reached'
      and ${eventLog.payloadJson}->>'campaignId' = ${campaign.id}
    `)
    .limit(1);
  assert.equal(capEvent?.payloadJson["runCap"], 1);
  assert.equal(capEvent?.payloadJson["dropped"], 1);

  const [cooldown] = await db
    .select({
      stateType: policyStateEntries.stateType,
      reasonCode: policyStateEntries.reasonCode,
      expiresAt: policyStateEntries.expiresAt
    })
    .from(policyStateEntries)
    .where(eq(policyStateEntries.scopeId, campaign.id))
    .limit(1);
  assert.equal(cooldown?.stateType, "discovery_cooldown");
  assert.equal(cooldown?.reasonCode, "campaign_discovery");
  assert.ok(cooldown?.expiresAt && cooldown.expiresAt > new Date());
});

async function insertRunningDiscoveryJob(
  campaignId: string,
  payload: { runCap: number; cooldownBetweenDiscoverySeconds: number }
): Promise<{ job: LeasedJob; runId: string; workerId: string }> {
  const db = getDb();
  const jobId = randomUUID();
  const runId = randomUUID();
  const workerId = `t026c-worker-${randomUUID()}`;
  const correlationId = randomUUID();

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.run_campaign_discovery",
    status: "running",
    workerPool: "background",
    targetEntityType: "campaign",
    targetEntityId: campaignId,
    payloadJson: { campaignId, ...payload },
    attempts: 1,
    maxAttempts: 3,
    leasedBy: workerId,
    leasedUntil: new Date(Date.now() + 60_000),
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
      job_type: "job.run_campaign_discovery",
      command_id: null,
      payload_json: { campaignId, ...payload },
      attempts: 1,
      max_attempts: 3,
      correlation_id: correlationId
    }
  };
}

async function clearT026CArtifacts(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    DELETE FROM policy_state_entries
    WHERE reason_text LIKE '%T026C%'
       OR scope_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
  `);
  await db.execute(sql`
    DELETE FROM event_log
    WHERE payload_json::text LIKE '%t026c-%'
       OR entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
       OR entity_id IN (SELECT id FROM discovery_candidates WHERE proposed_name LIKE 't026c-%')
       OR job_id IN (
         SELECT id FROM jobs
         WHERE payload_json::text LIKE '%t026c-%'
            OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
       )
       OR command_id IN (
         SELECT id FROM commands
         WHERE payload_json::text LIKE '%t026c-%'
            OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
       )
  `);
  await db.execute(sql`DELETE FROM discovery_candidates WHERE proposed_name LIKE 't026c-%'`);
  await db.delete(agentRunEvents).where(sql`
    agent_run_id IN (
      SELECT id FROM agent_runs
      WHERE job_id IN (
        SELECT id FROM jobs
        WHERE payload_json::text LIKE '%t026c-%'
           OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
      )
    )
  `);
  await db.delete(agentRunArtifacts).where(sql`
    agent_run_id IN (
      SELECT id FROM agent_runs
      WHERE job_id IN (
        SELECT id FROM jobs
        WHERE payload_json::text LIKE '%t026c-%'
           OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
      )
    )
  `);
  await db.delete(agentRuns).where(sql`
    job_id IN (
      SELECT id FROM jobs
      WHERE payload_json::text LIKE '%t026c-%'
         OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
    )
  `);
  await db.delete(jobRuns).where(sql`
    job_id IN (
      SELECT id FROM jobs
      WHERE payload_json::text LIKE '%t026c-%'
         OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
    )
  `);
  await db.execute(sql`
    DELETE FROM jobs
    WHERE payload_json::text LIKE '%t026c-%'
       OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
  `);
  await db.execute(sql`
    DELETE FROM commands
    WHERE payload_json::text LIKE '%t026c-%'
       OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026c-%')
  `);
  await db.execute(sql`DELETE FROM campaigns WHERE name LIKE 't026c-%'`);
}
