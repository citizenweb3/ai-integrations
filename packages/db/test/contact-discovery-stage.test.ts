import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  agentRuns,
  closeDb,
  eventLog,
  getDb,
  jobs,
  organizations,
  researchContactCandidates,
  researchSnapshots,
  routeContactDiscoveryOutcome,
  routeResearchSnapshotOutcome
} from "../src";

after(async () => {
  await closeDb();
});

async function createG42AgentRun(stage: string): Promise<string> {
  const db = getDb();
  const [run] = await db
    .insert(agentRuns)
    .values({ stage, status: "succeeded", inputSnapshotJson: { test: "g42" } })
    .returning({ id: agentRuns.id });
  assert.ok(run);
  return run.id;
}

test("research snapshot router chains a contact-discovery job", async (t) => {
  const db = getDb();
  await clearG42Artifacts();
  t.after(clearG42Artifacts);

  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({ name: `g42-chain-${suffix}`, domain: `g42-chain-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const agentRunId = await createG42AgentRun("research_snapshot");
  const result = await routeResearchSnapshotOutcome({
    agentRunId,
    organizationId: organization.id,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      summary: "Test org.",
      facts: [],
      questions: [],
      contactCandidates: []
    })
  });
  assert.ok(result);

  const chained = await db
    .select({ jobType: jobs.jobType, payloadJson: jobs.payloadJson, concurrencyKey: jobs.concurrencyKey })
    .from(jobs)
    .where(and(
      eq(jobs.jobType, "job.discover_contacts"),
      eq(jobs.targetEntityId, organization.id)
    ));
  assert.equal(chained.length, 1, "exactly one discover_contacts job should be chained");
  assert.equal(chained[0]?.concurrencyKey, `research_snapshot:${organization.id}`);
  assert.equal(chained[0]?.payloadJson["organizationId"], organization.id);
  assert.match(String(chained[0]?.payloadJson["prompt"] ?? ""), /contact candidates for g42-chain-/);
});

test("contact-discovery router persists candidates into the review queue", async (t) => {
  const db = getDb();
  await clearG42Artifacts();
  t.after(clearG42Artifacts);

  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({ name: `g42-route-${suffix}`, domain: `g42-route-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const email = `g42-jordan-${suffix}@example.com`;
  const agentRunId = await createG42AgentRun("contact_candidate_discovery");
  const result = await routeContactDiscoveryOutcome({
    agentRunId,
    organizationId: organization.id,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      contactCandidates: [
        {
          fullName: "Jordan Lee",
          email,
          role: "Head of Partnerships",
          source: "website_team_page",
          evidenceUrl: `https://g42-route-${suffix}.example/team`,
          sourceRefs: [{ url: `https://g42-route-${suffix}.example/team` }],
          confidence: "high"
        }
      ]
    })
  });
  assert.equal(result?.contactCandidateCount, 1);
  assert.equal(result?.insertedCount, 1);

  const [candidate] = await db
    .select({ status: researchContactCandidates.status, email: researchContactCandidates.email })
    .from(researchContactCandidates)
    .where(eq(researchContactCandidates.organizationId, organization.id))
    .limit(1);
  assert.equal(candidate?.status, "pending");
  assert.equal(candidate?.email, email);

  const [event] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`${eventLog.eventType} = 'contact_discovery_completed'
      and ${eventLog.entityId} = ${organization.id}`)
    .limit(1);
  assert.equal(event?.payloadJson["contactCandidateInsertedCount"], 1);
});

async function clearG42Artifacts(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    delete from event_log
    where entity_id in (
      select id from organizations where name like 'g42-%'
      union
      select rs.id from research_snapshots rs
      join organizations o on o.id = rs.organization_id where o.name like 'g42-%'
      union
      select rcc.id from research_contact_candidates rcc
      join organizations o on o.id = rcc.organization_id where o.name like 'g42-%'
    )
  `);
  await db.execute(sql`
    delete from jobs
    where target_entity_type = 'organization'
      and target_entity_id in (select id from organizations where name like 'g42-%')
  `);
  await db.execute(sql`
    delete from research_contact_candidates
    where organization_id in (select id from organizations where name like 'g42-%')
  `);
  await db.execute(sql`
    delete from research_snapshots
    where organization_id in (select id from organizations where name like 'g42-%')
  `);
  await db.execute(sql`delete from organizations where name like 'g42-%'`);
}
