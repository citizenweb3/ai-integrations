import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  acceptDiscoveryCandidateCommand,
  campaigns,
  closeDb,
  commands,
  discoveryCandidates,
  eventLog,
  getDb,
  rejectDiscoveryCandidateCommand,
  routeCampaignDiscoveryOutcome
} from "../src";

after(async () => {
  await closeDb();
});

test("accept and reject discovery candidate commands require an active campaign", async (t) => {
  const db = getDb();
  await clearT026BArtifacts();
  t.after(clearT026BArtifacts);

  const suffix = randomUUID();
  const [pausedCampaign] = await db
    .insert(campaigns)
    .values({
      name: `t026b-paused-${suffix}`,
      status: "paused",
      objective: "Paused campaign should block discovery actions.",
      targetSegments: ["T026B"]
    })
    .returning({ id: campaigns.id });
  assert.ok(pausedCampaign);
  const [closedCampaign] = await db
    .insert(campaigns)
    .values({
      name: `t026b-closed-${suffix}`,
      status: "closed",
      objective: "Closed campaign should block discovery actions.",
      targetSegments: ["T026B"]
    })
    .returning({ id: campaigns.id });
  assert.ok(closedCampaign);

  const [acceptCandidate] = await db
    .insert(discoveryCandidates)
    .values({
      campaignId: pausedCampaign.id,
      proposedName: `t026b-accept-${suffix}`,
      domain: `t026b-accept-${suffix}.example`,
      sourceRefs: [{ url: "https://example.com/t026b-accept" }],
      status: "proposed"
    })
    .returning({ id: discoveryCandidates.id });
  assert.ok(acceptCandidate);
  const [rejectCandidate] = await db
    .insert(discoveryCandidates)
    .values({
      campaignId: closedCampaign.id,
      proposedName: `t026b-reject-${suffix}`,
      domain: `t026b-reject-${suffix}.example`,
      sourceRefs: [{ url: "https://example.com/t026b-reject" }],
      status: "proposed"
    })
    .returning({ id: discoveryCandidates.id });
  assert.ok(rejectCandidate);

  const accept = await acceptDiscoveryCandidateCommand({
    payload: { candidateId: acceptCandidate.id }
  });
  assert.equal(accept.ok, false);
  if (accept.ok) assert.fail("paused campaign accept should fail");
  assert.equal(accept.failure.code, "campaign_not_active");

  const reject = await rejectDiscoveryCandidateCommand({
    payload: {
      candidateId: rejectCandidate.id,
      reasonCode: "competitor",
      reasonText: "T026B should not mutate on closed campaign"
    }
  });
  assert.equal(reject.ok, false);
  if (reject.ok) assert.fail("closed campaign reject should fail");
  assert.equal(reject.failure.code, "campaign_not_active");

  const candidateRows = await db
    .select({ id: discoveryCandidates.id, status: discoveryCandidates.status })
    .from(discoveryCandidates)
    .where(sql`${discoveryCandidates.id} in (${acceptCandidate.id}, ${rejectCandidate.id})`);
  assert.deepEqual(
    new Map(candidateRows.map((row) => [row.id, row.status])),
    new Map([
      [acceptCandidate.id, "proposed"],
      [rejectCandidate.id, "proposed"]
    ])
  );

  const commandRows = await db
    .select({ id: commands.id })
    .from(commands)
    .where(sql`${commands.targetEntityId} in (${acceptCandidate.id}, ${rejectCandidate.id})`);
  assert.equal(commandRows.length, 0);
});

test("rejectDiscoveryCandidateCommand stores reason code separately from operator notes", async (t) => {
  const db = getDb();
  await clearT026BArtifacts();
  t.after(clearT026BArtifacts);

  const suffix = randomUUID();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t026b-active-${suffix}`,
      status: "active",
      objective: "Active campaign should allow structured rejection.",
      targetSegments: ["T026B"]
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [candidate] = await db
    .insert(discoveryCandidates)
    .values({
      campaignId: campaign.id,
      proposedName: `t026b-structured-${suffix}`,
      domain: `t026b-structured-${suffix}.example`,
      sourceRefs: [{ url: "https://example.com/t026b-structured" }],
      status: "proposed"
    })
    .returning({ id: discoveryCandidates.id });
  assert.ok(candidate);

  const result = await rejectDiscoveryCandidateCommand({
    payload: {
      candidateId: candidate.id,
      reasonCode: "existing_customer",
      reasonText: "Already in a renewal workflow."
    }
  });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail(result.failure.message);

  const [updated] = await db
    .select({
      status: discoveryCandidates.status,
      rejectionReason: discoveryCandidates.rejectionReason,
      rejectionReasonCode: discoveryCandidates.rejectionReasonCode
    })
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.id, candidate.id))
    .limit(1);
  assert.deepEqual(updated, {
    status: "rejected_by_policy",
    rejectionReason: "Already in a renewal workflow.",
    rejectionReasonCode: "existing_customer"
  });

  const [command] = await db
    .select({ payloadJson: commands.payloadJson })
    .from(commands)
    .where(eq(commands.id, result.command.id))
    .limit(1);
  assert.equal(command?.payloadJson["reasonCode"], "existing_customer");

  const [event] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(eq(eventLog.commandId, result.command.id))
    .limit(1);
  assert.equal(event?.payloadJson["reasonCode"], "existing_customer");
  assert.equal(event?.payloadJson["reasonText"], "Already in a renewal workflow.");
});

test("campaign discovery router rejects proposals whose source refs are only Google or Vertex redirects", async (t) => {
  const db = getDb();
  await clearT026BArtifacts();
  t.after(clearT026BArtifacts);

  const suffix = randomUUID();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t026b-router-${suffix}`,
      status: "active",
      objective: "Router should reject redirected-only source refs.",
      targetSegments: ["T026B"]
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const agentRunId = randomUUID();
  const result = await routeCampaignDiscoveryOutcome({
    agentRunId,
    campaignId: campaign.id,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      candidates: [
        {
          proposedName: `t026b-redirect-only-${suffix}`,
          domain: `t026b-redirect-${suffix}.example`,
          sourceRefs: [
            { url: "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fcompany" },
            { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/example" }
          ]
        }
      ]
    })
  });

  assert.deepEqual(result, {
    proposalsTotal: 1,
    inserted: 0,
    rejected: 1,
    needsReview: 0,
    duplicates: 0,
    autoLinked: 0,
    novel: 0
  });

  const insertedRows = await db
    .select({ id: discoveryCandidates.id })
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.campaignId, campaign.id));
  assert.equal(insertedRows.length, 0);

  const [routerEvent] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(eq(eventLog.entityId, agentRunId))
    .limit(1);
  assert.equal(routerEvent?.payloadJson["reason"], "all_sourceRefs_redirected");
});

test("accept auto-chain enrichment prompt carries campaign context", async (t) => {
  const db = getDb();
  await clearT026BArtifacts();
  t.after(clearT026BArtifacts);

  const suffix = randomUUID();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t026b-ctx-${suffix}`,
      status: "active",
      objective: "Sell our SOC-2 audit automation platform.",
      offerSummary: "Continuous SOC-2 evidence collection and audit automation.",
      targetSegments: ["fintech", "healthtech"],
      desiredCta: "Book a 20-minute compliance readiness call.",
      operatorNotes: "Prioritize companies actively pursuing SOC-2."
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [candidate] = await db
    .insert(discoveryCandidates)
    .values({
      campaignId: campaign.id,
      proposedName: `t026b-ctx-org-${suffix}`,
      domain: `t026b-ctx-${suffix}.example`,
      sourceRefs: [{ url: "https://example.com/t026b-ctx" }],
      status: "proposed"
    })
    .returning({ id: discoveryCandidates.id });
  assert.ok(candidate);

  const accept = await acceptDiscoveryCandidateCommand({
    payload: { candidateId: candidate.id }
  });
  assert.equal(accept.ok, true);
  if (!accept.ok) assert.fail(accept.failure.message);

  // The accept auto-chains an enrichment command whose payload carries the
  // research prompt. Find it by the candidate back-pointer and assert the
  // campaign scope made it into the prompt.
  const [enrichmentCommand] = await db
    .select({ payloadJson: commands.payloadJson })
    .from(commands)
    .where(sql`${commands.commandType} = 'refresh_research_snapshot'
      and ${commands.payloadJson}->>'triggeredByCandidateId' = ${candidate.id}`)
    .limit(1);
  const prompt = String(enrichmentCommand?.payloadJson["prompt"] ?? "");
  assert.match(prompt, /<campaign_context>/);
  assert.match(prompt, /Sell our SOC-2 audit automation platform\./);
  assert.match(prompt, /Continuous SOC-2 evidence collection and audit automation\./);
  assert.match(prompt, /fintech, healthtech/);
  assert.match(prompt, /Book a 20-minute compliance readiness call\./);
  assert.match(prompt, /Prioritize companies actively pursuing SOC-2\./);
});

async function clearT026BArtifacts(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    DELETE FROM event_log
    WHERE payload_json::text LIKE '%t026b-%'
       OR entity_id IN (SELECT id FROM discovery_candidates WHERE proposed_name LIKE 't026b-%')
       OR command_id IN (
         SELECT id FROM commands
         WHERE target_entity_id IN (SELECT id FROM discovery_candidates WHERE proposed_name LIKE 't026b-%')
       )
  `);
  await db.execute(sql`
    DELETE FROM jobs
    WHERE target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026b-%')
       OR payload_json::text LIKE '%t026b-%'
  `);
  await db.execute(sql`
    DELETE FROM commands
    WHERE payload_json::text LIKE '%t026b-%'
       OR target_entity_id IN (SELECT id FROM discovery_candidates WHERE proposed_name LIKE 't026b-%')
       OR target_entity_id IN (SELECT id FROM campaigns WHERE name LIKE 't026b-%')
  `);
  await db.execute(sql`DELETE FROM discovery_candidates WHERE proposed_name LIKE 't026b-%'`);
  // accept materializes an organization named from the candidate; drop those too.
  await db.execute(sql`DELETE FROM organizations WHERE name LIKE 't026b-%'`);
  await db.execute(sql`DELETE FROM campaigns WHERE name LIKE 't026b-%'`);
}
