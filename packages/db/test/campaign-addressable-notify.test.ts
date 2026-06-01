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
  routeContactDiscoveryOutcome
} from "../src";

// T-026BE — notification A ("first contact ready"). The contact-discovery
// router auto-converts a candidate that already carries an email into a
// contacts row (T-026AU); the campaign crossing zero → one addressable
// contact must enqueue exactly one telegram notification, and a second
// addressable contact must not enqueue another.

const PREFIX = "bn-addr-";

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

async function makeCampaignWithOrg(suffix: string): Promise<{ campaignId: string; organizationId: string }> {
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
  // Link org → campaign via an accepted discovery candidate (the only
  // campaign↔org link the helpers rely on).
  await db.insert(discoveryCandidates).values({
    campaignId: campaign.id,
    proposedName: `${PREFIX}org-${suffix}`,
    domain: `${PREFIX}${suffix}.example`,
    status: "enriched",
    matchedOrganizationId: organization.id
  });
  return { campaignId: campaign.id, organizationId: organization.id };
}

async function addressableJobs(campaignId: string) {
  const db = getDb();
  return db
    .select({ id: jobs.id, payloadJson: jobs.payloadJson, concurrencyKey: jobs.concurrencyKey })
    .from(jobs)
    .where(eq(jobs.concurrencyKey, `telegram_notification:campaign_addressable_ready:${campaignId}`));
}

test("first addressable contact enqueues exactly one telegram notification", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix);
  const email = `${PREFIX}lead-${suffix}@example.com`;

  const agentRunId = await makeAgentRun();
  await routeContactDiscoveryOutcome({
    agentRunId,
    organizationId,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      contactCandidates: [
        {
          fullName: "Dana Reeves",
          email,
          role: "Head of BD",
          source: "website_team_page",
          evidenceUrl: `https://${PREFIX}${suffix}.example/team`,
          sourceRefs: [{ url: `https://${PREFIX}${suffix}.example/team` }],
          confidence: "high"
        }
      ]
    })
  });

  const notifs = await addressableJobs(campaignId);
  assert.equal(notifs.length, 1, "exactly one addressable-ready notification");
  assert.equal(notifs[0]?.payloadJson["entityType"], "campaign");
  assert.equal(notifs[0]?.payloadJson["entityId"], campaignId);
  assert.match(String(notifs[0]?.payloadJson["text"] ?? ""), /First contact ready/);
  assert.match(String(notifs[0]?.payloadJson["text"] ?? ""), new RegExp(email.replace(/[.+]/g, "\\$&")));
});

test("a second addressable contact does not enqueue another notification", async (t) => {
  await clearArtifacts();
  t.after(clearArtifacts);

  const suffix = randomUUID();
  const { campaignId, organizationId } = await makeCampaignWithOrg(suffix);

  // First addressable contact.
  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      contactCandidates: [
        {
          fullName: "First Lead",
          email: `${PREFIX}one-${suffix}@example.com`,
          role: "BD",
          source: "website_team_page",
          evidenceUrl: `https://${PREFIX}${suffix}.example/a`,
          sourceRefs: [{ url: `https://${PREFIX}${suffix}.example/a` }],
          confidence: "high"
        }
      ]
    })
  });
  assert.equal((await addressableJobs(campaignId)).length, 1);

  // Second addressable contact for the same campaign.
  await routeContactDiscoveryOutcome({
    agentRunId: await makeAgentRun(),
    organizationId,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      contactCandidates: [
        {
          fullName: "Second Lead",
          email: `${PREFIX}two-${suffix}@example.com`,
          role: "Sales",
          source: "website_team_page",
          evidenceUrl: `https://${PREFIX}${suffix}.example/b`,
          sourceRefs: [{ url: `https://${PREFIX}${suffix}.example/b` }],
          confidence: "high"
        }
      ]
    })
  });

  assert.equal(
    (await addressableJobs(campaignId)).length,
    1,
    "still exactly one — dedup must suppress the second"
  );
});

async function clearArtifacts(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    delete from jobs
    where concurrency_key like 'telegram_notification:campaign_%'
      and target_entity_id in (select id from campaigns where name like '${sql.raw(PREFIX)}%')
  `);
  // Notification jobs use entityId in payload, target_entity_id is null —
  // clear by concurrency key tied to our campaigns, then the rest by prefix.
  await db.execute(sql`
    delete from jobs where concurrency_key in (
      select 'telegram_notification:campaign_addressable_ready:' || id::text from campaigns where name like '${sql.raw(PREFIX)}%'
      union
      select 'telegram_notification:campaign_expansion_done:' || id::text || ':v' || discovery_scope_version::text from campaigns where name like '${sql.raw(PREFIX)}%'
    )
  `);
  await db.execute(sql`
    delete from jobs
    where target_entity_id in (select id from organizations where name like '${sql.raw(PREFIX)}%')
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
  await db.execute(sql`
    delete from discovery_candidates where campaign_id in (select id from campaigns where name like '${sql.raw(PREFIX)}%')
  `);
  await db.execute(sql`delete from organizations where name like '${sql.raw(PREFIX)}%'`);
  await db.execute(sql`delete from campaigns where name like '${sql.raw(PREFIX)}%'`);
}
