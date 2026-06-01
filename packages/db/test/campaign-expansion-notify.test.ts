import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  agentRuns,
  campaigns,
  closeDb,
  discoveryCandidates,
  getDb,
  jobs,
  organizations,
  policyStateEntries,
  routeContactDiscoveryOutcome,
  routeResearchSnapshotOutcome
} from "../src";

// T-026BE — notification B ("campaign ready / expansion complete"). Fires
// from the contact-discovery anchor when discovery cooldown is active AND no
// campaign-scoped research/contact job is still in flight. Exercised through
// the public router so the two anchors and the dedup behave as in production.

const PREFIX = "bn-exp-";

after(async () => {
  await closeDb();
});

async function makeAgentRun(): Promise<string> {
  const db = getDb();
  const [run] = await db
    .insert(agentRuns)
    .values({ stage: "contact_candidate_discovery", status: "succeeded", inputSnapshotJson: { test: "bn" } })
    .returning({ id: agentRuns.id });
  assert.ok(run);
  return run.id;
}

async function makeCampaignWithOrg(
  suffix: string,
  opts: { cooldown: boolean }
): Promise<{ campaignId: string; organizationId: string }> {
  const db = getDb();
  const [campaign] = await db
    .insert(campaigns)
    .values({ name: `${PREFIX}camp-${suffix}`, objective: "test", status: "active" })
    .returning({ id: campaigns.id });
  assert.ok(campaign);
  const [organization] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}org-${suffix}`, domain: `${PREFIX}${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);
  await db.insert(discoveryCandidates).values({
    campaignId: campaign.id,
    proposedName: `${PREFIX}org-${suffix}`,
    domain: `${PREFIX}${suffix}.example`,
    status: "enriched",
    matchedOrganizationId: organization.id
  });
  if (opts.cooldown) {
    await db.insert(policyStateEntries).values({
      scopeType: "campaign",
      scopeId: campaign.id,
      stateType: "discovery_cooldown",
      status: "active",
      reasonCode: "campaign_discovery",
      expiresAt: new Date(Date.now() + 3600_000)
    });
  }
  return { campaignId: campaign.id, organizationId: organization.id };
}

async function expansionJobs(campaignId: string, scopeVersion = 1) {
  const db = getDb();
  return db
    .select({ payloadJson: jobs.payloadJson })
    .from(jobs)
    .where(eq(jobs.concurrencyKey, `telegram_notification:campaign_expansion_done:${campaignId}:v${scopeVersion}`));
}

function emptyContactRun() {
  return JSON.stringify({ contactCandidates: [] });
}

test("cooldown active + empty queue enqueues the expansion-complete notification", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix, { cooldown: true });

  // One addressable contact so the text reports a non-zero count.
  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      contactCandidates: [
        {
          fullName: "Pat Ng",
          email: `${PREFIX}pat-${suffix}@example.com`,
          role: "BD",
          source: "website_team_page",
          evidenceUrl: `https://${PREFIX}${suffix}.example/team`,
          sourceRefs: [{ url: `https://${PREFIX}${suffix}.example/team` }],
          confidence: "high"
        }
      ]
    })
  });

  const notifs = await expansionJobs(campaignId);
  assert.equal(notifs.length, 1, "exactly one expansion-complete notification");
  assert.match(String(notifs[0]?.payloadJson["text"] ?? ""), /Campaign ready/);
  assert.match(String(notifs[0]?.payloadJson["text"] ?? ""), /1 addressable contact\b/);
});

test("no cooldown means no expansion-complete notification", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix, { cooldown: false });

  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: emptyContactRun()
  });

  assert.equal((await expansionJobs(campaignId)).length, 0, "no cooldown → no notification");
});

test("a research/contact job still in flight blocks the notification", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix, { cooldown: true });

  // A research job for the same org still queued → pending > 0.
  await getDb().insert(jobs).values({
    jobType: "job.refresh_research_snapshot",
    status: "queued",
    workerPool: "drafting",
    targetEntityType: "organization",
    targetEntityId: organizationId,
    payloadJson: { organizationId },
    correlationId: randomUUID()
  });

  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: emptyContactRun()
  });

  assert.equal((await expansionJobs(campaignId)).length, 0, "pending research job must block B");
});

test("zero addressable contacts still notifies with the empty-batch text", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix, { cooldown: true });

  // Contact run with a candidate that has NO email → no addressable contact.
  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      contactCandidates: [
        {
          fullName: "No Email Person",
          role: "BD",
          source: "website_team_page",
          evidenceUrl: `https://${PREFIX}${suffix}.example/team`,
          sourceRefs: [{ url: `https://${PREFIX}${suffix}.example/team` }],
          confidence: "medium"
        }
      ]
    })
  });

  const notifs = await expansionJobs(campaignId);
  assert.equal(notifs.length, 1, "B still fires with zero addressable");
  assert.match(String(notifs[0]?.payloadJson["text"] ?? ""), /0 addressable contacts/);
  assert.match(String(notifs[0]?.payloadJson["text"] ?? ""), /No reachable contacts found/);
});

test("a second discovery scope version re-arms the notification", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix, { cooldown: true });
  const db = getDb();

  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: emptyContactRun()
  });
  assert.equal((await expansionJobs(campaignId, 1)).length, 1, "v1 ping fired");

  // Simulate a resume / scope edit: bump the discovery scope version.
  await db
    .update(campaigns)
    .set({ discoveryScopeVersion: 2 })
    .where(eq(campaigns.id, campaignId));

  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: emptyContactRun()
  });

  assert.equal((await expansionJobs(campaignId, 2)).length, 1, "v2 ping re-armed and fired");
});

test("a research_more job finishing last also fires the notification", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix, { cooldown: true });

  // Simulate the production tail order: contact discovery already closed,
  // and a research_more run (chainContactDiscovery=false) is the last job to
  // finish. The expansion-complete ping must fire from the research anchor,
  // not only the contact-discovery one.
  const [run] = await getDb()
    .insert(agentRuns)
    .values({ stage: "research_more", status: "succeeded", inputSnapshotJson: { test: "bn" } })
    .returning({ id: agentRuns.id });
  assert.ok(run);

  await routeResearchSnapshotOutcome({
    agentRunId: run.id,
    organizationId,
    correlationId: randomUUID(),
    finalText: JSON.stringify({ summary: "More facts.", facts: [], questions: [] }),
    chainContactDiscovery: false
  });

  const notifs = await expansionJobs(campaignId);
  assert.equal(notifs.length, 1, "research_more as last job must fire B");
  assert.match(String(notifs[0]?.payloadJson["text"] ?? ""), /Campaign ready/);
});

async function clearArtifacts(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    delete from jobs where concurrency_key in (
      select 'telegram_notification:campaign_addressable_ready:' || id::text from campaigns where name like '${sql.raw(PREFIX)}%'
      union select 'telegram_notification:campaign_expansion_done:' || id::text || ':v1' from campaigns where name like '${sql.raw(PREFIX)}%'
      union select 'telegram_notification:campaign_expansion_done:' || id::text || ':v2' from campaigns where name like '${sql.raw(PREFIX)}%'
    )
  `);
  await db.execute(sql`
    delete from jobs
    where target_entity_id in (select id from organizations where name like '${sql.raw(PREFIX)}%')
  `);
  await db.execute(sql`
    delete from policy_state_entries
    where scope_id in (select id from campaigns where name like '${sql.raw(PREFIX)}%')
  `);
  await db.execute(sql`
    delete from event_log
    where entity_id in (
      select id from organizations where name like '${sql.raw(PREFIX)}%'
      union select id from campaigns where name like '${sql.raw(PREFIX)}%'
      union select rcc.id from research_contact_candidates rcc
        join organizations o on o.id = rcc.organization_id where o.name like '${sql.raw(PREFIX)}%'
    )
  `);
  // research_contact_candidates first — its converted_contact_id FK points
  // at contacts, so contacts cannot be deleted while candidates reference them.
  await db.execute(sql`
    delete from research_contact_candidates where organization_id in (select id from organizations where name like '${sql.raw(PREFIX)}%')
  `);
  await db.execute(sql`
    delete from contacts where organization_id in (select id from organizations where name like '${sql.raw(PREFIX)}%')
  `);
  // research_snapshots + their facts/evidence (created by routeResearchSnapshotOutcome).
  await db.execute(sql`
    delete from research_snapshots where organization_id in (select id from organizations where name like '${sql.raw(PREFIX)}%')
  `);
  await db.execute(sql`
    delete from discovery_candidates where campaign_id in (select id from campaigns where name like '${sql.raw(PREFIX)}%')
  `);
  await db.execute(sql`delete from organizations where name like '${sql.raw(PREFIX)}%'`);
  await db.execute(sql`delete from campaigns where name like '${sql.raw(PREFIX)}%'`);
}
