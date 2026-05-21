import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  agentRuns,
  closeDb,
  eventLog,
  getDb,
  getOrganizationDetail,
  organizations,
  ragDocuments,
  researchContactCandidates,
  researchFacts,
  researchSnapshots,
  routeResearchSnapshotOutcome
} from "../src";

after(async () => {
  await closeDb();
});

test("research router persists Step 4 output polish", async (t) => {
  const db = getDb();
  await clearT026DArtifacts();
  t.after(clearT026DArtifacts);

  const suffix = randomUUID();
  const domain = `t026d-${suffix}.example`;
  const email = `t026d-jordan-${suffix}@example.com`;

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t026d-org-${suffix}`,
      domain
    })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const firstAgentRunId = await createT026DAgentRun(suffix);
  const firstResult = await routeResearchSnapshotOutcome({
    agentRunId: firstAgentRunId,
    organizationId: organization.id,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      summary: "T026D ResearchCo publishes procurement automation details.",
      questions: [
        "Who owns partner operations?",
        "Who owns partner operations?",
        "What compliance systems are mentioned?"
      ],
      facts: [
        {
          claim: "T026D ResearchCo documents procurement automation controls for partner operations.",
          confidence: "high",
          evidence: [
            {
              sourceUrl: `https://${domain}/security/procurement`,
              sourceType: "url_fetch",
              quoteText: "Procurement automation controls for partner operations.",
              supportType: "supports"
            },
            {
              sourceUrl: `https://www.sec.gov/Archives/edgar/t026d-${suffix}`,
              sourceType: "search_result",
              quoteText: "Independent filing evidence for procurement controls.",
              supportType: "supports"
            }
          ]
        }
      ],
      contactCandidates: [
        {
          fullName: "Jordan Source",
          email,
          role: "Head of Partnerships",
          source: "website_team_page",
          evidenceUrl: `https://${domain}/people/jordan#profile`,
          sourceRefs: [
            {
              url: `https://${domain}/team`,
              title: "Team",
              snippet: "Jordan Source leads partnerships."
            },
            {
              url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AWQVqAJ",
              title: "Tracker"
            }
          ],
          confidence: "high",
          notes: "Listed on the public team page."
        },
        {
          fullName: "Morgan Noemail",
          email: null,
          role: "Operations Lead",
          source: "conference_bio",
          evidenceUrl: `https://${domain}/events/morgan`,
          sourceRefs: [
            {
              url: `https://${domain}/events`,
              title: "Events",
              snippet: "Morgan Noemail is listed as an operations speaker."
            }
          ],
          confidence: "medium",
          notes: "No email found."
        }
      ]
    })
  });

  assert.equal(firstResult?.factCount, 1);
  assert.equal(firstResult?.evidenceCount, 2);
  assert.equal(firstResult?.contactCandidateCount, 2);
  assert.equal(firstResult?.enrichedCandidateCount, 0);

  const [snapshot] = await db
    .select({
      id: researchSnapshots.id,
      questionsJson: researchSnapshots.questionsJson
    })
    .from(researchSnapshots)
    .where(eq(researchSnapshots.organizationId, organization.id))
    .orderBy(desc(researchSnapshots.snapshotVersion))
    .limit(1);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.questionsJson, [
    "Who owns partner operations?",
    "What compliance systems are mentioned?"
  ]);

  const [fact] = await db
    .select({
      id: researchFacts.id,
      status: researchFacts.status,
      confidence: researchFacts.confidence,
      safeForCopy: researchFacts.safeForCopy
    })
    .from(researchFacts)
    .where(eq(researchFacts.snapshotId, snapshot.id))
    .limit(1);
  assert.ok(fact);
  assert.equal(fact.status, "active");
  assert.equal(fact.confidence, 85);
  assert.equal(fact.safeForCopy, true);

  const [ragDoc] = await db
    .select({
      id: ragDocuments.id,
      sourceEntityType: ragDocuments.sourceEntityType,
      sourceEntityId: ragDocuments.sourceEntityId,
      corpusLabel: ragDocuments.corpusLabel,
      eligibleForRetrieval: ragDocuments.eligibleForRetrieval,
      body: ragDocuments.body
    })
    .from(ragDocuments)
    .where(eq(ragDocuments.sourceEntityId, fact.id))
    .limit(1);
  assert.ok(ragDoc);
  assert.equal(ragDoc.sourceEntityType, "research_fact");
  assert.equal(ragDoc.sourceEntityId, fact.id);
  assert.equal(ragDoc.corpusLabel, "research_fact");
  assert.equal(ragDoc.eligibleForRetrieval, true);
  assert.match(ragDoc.body, /Evidence:/);

  const secondAgentRunId = await createT026DAgentRun(suffix);
  const secondResult = await routeResearchSnapshotOutcome({
    agentRunId: secondAgentRunId,
    organizationId: organization.id,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      questions: ["Which team owns expansion?"],
      facts: [],
      contactCandidates: [
        {
          fullName: "Jordan Source",
          email,
          role: "Head of Strategic Partnerships",
          source: "press_release",
          evidenceUrl: `https://${domain}/news/jordan-source`,
          sourceRefs: [
            {
              url: `https://${domain}/news/partnerships`,
              title: "Partnerships update",
              snippet: "Jordan Source is named in the partnerships update."
            }
          ],
          confidence: "medium",
          notes: "Reconfirmed by a newer source."
        },
        {
          fullName: "Morgan Noemail",
          email: null,
          role: "Senior Operations Lead",
          source: "webinar_bio",
          evidenceUrl: `https://${domain}/webinars/morgan`,
          sourceRefs: [
            {
              url: `https://${domain}/webinars`,
              title: "Webinars",
              snippet: "Morgan Noemail hosts the partner operations webinar."
            }
          ],
          confidence: "high",
          notes: "Reconfirmed without an email."
        }
      ]
    })
  });

  assert.equal(secondResult?.contactCandidateCount, 2);

  const candidates = await db
    .select({
      id: researchContactCandidates.id,
      email: researchContactCandidates.email,
      role: researchContactCandidates.role,
      sourceRefs: researchContactCandidates.sourceRefs,
      confidence: researchContactCandidates.confidence
    })
    .from(researchContactCandidates)
    .where(eq(researchContactCandidates.organizationId, organization.id));
  assert.equal(candidates.length, 2);

  const emailCandidate = candidates.find((candidate) => candidate.email === email);
  assert.ok(emailCandidate);
  assert.equal(emailCandidate.role, "Head of Strategic Partnerships");
  assert.equal(emailCandidate.confidence, 85);
  const sourceUrls = emailCandidate.sourceRefs.map((ref) => ref.url);
  assert.ok(sourceUrls.includes(`https://${domain}/team`));
  assert.ok(sourceUrls.includes(`https://${domain}/people/jordan`));
  assert.ok(sourceUrls.includes(`https://${domain}/news/partnerships`));
  assert.ok(sourceUrls.includes(`https://${domain}/news/jordan-source`));
  assert.equal(sourceUrls.some((url) => url.includes("vertexaisearch.cloud.google.com")), false);

  const noEmailCandidate = candidates.find((candidate) => candidate.email === null);
  assert.ok(noEmailCandidate);
  assert.equal(noEmailCandidate.role, "Senior Operations Lead");
  assert.equal(noEmailCandidate.confidence, 85);
  const noEmailSourceUrls = noEmailCandidate.sourceRefs.map((ref) => ref.url);
  assert.ok(noEmailSourceUrls.includes(`https://${domain}/events`));
  assert.ok(noEmailSourceUrls.includes(`https://${domain}/events/morgan`));
  assert.ok(noEmailSourceUrls.includes(`https://${domain}/webinars`));
  assert.ok(noEmailSourceUrls.includes(`https://${domain}/webinars/morgan`));

  const manualEvents = await db
    .select({ eventType: eventLog.eventType })
    .from(eventLog)
    .where(and(
      eq(eventLog.entityType, "organization"),
      eq(eventLog.entityId, organization.id),
      eq(eventLog.eventType, "manual_org_research_completed")
    ));
  assert.equal(manualEvents.length, 2);

  const detail = await getOrganizationDetail(organization.id);
  assert.ok(detail);
  assert.deepEqual(detail.latestSnapshot?.questions, ["Which team owns expansion?"]);
  assert.equal(detail.pendingContactCandidates.length, 2);
  assert.deepEqual(
    detail.pendingContactCandidates.find((candidate) => candidate.email === email)?.sourceRefs.map((ref) => ref.url),
    sourceUrls
  );
});

async function createT026DAgentRun(suffix: string): Promise<string> {
  const db = getDb();
  const [run] = await db
    .insert(agentRuns)
    .values({
      stage: "research_snapshot",
      status: "succeeded",
      inputSnapshotJson: { test: "t026d", suffix }
    })
    .returning({ id: agentRuns.id });
  assert.ok(run);
  return run.id;
}

async function clearT026DArtifacts() {
  const db = getDb();

  await db.execute(sql`
    delete from event_log
    where entity_id in (
      select id from organizations where name like 't026d-%'
      union
      select rs.id
      from research_snapshots rs
      join organizations o on o.id = rs.organization_id
      where o.name like 't026d-%'
      union
      select rcc.id
      from research_contact_candidates rcc
      join organizations o on o.id = rcc.organization_id
      where o.name like 't026d-%'
      union
      select rd.id
      from rag_documents rd
      join organizations o on o.id = rd.organization_id
      where o.name like 't026d-%'
    )
    or job_id in (
      select j.id
      from jobs j
      join rag_documents rd on rd.id = j.target_entity_id
      join organizations o on o.id = rd.organization_id
      where o.name like 't026d-%'
    )
  `);
  await db.execute(sql`
    delete from job_runs
    where job_id in (
      select j.id
      from jobs j
      join rag_documents rd on rd.id = j.target_entity_id
      join organizations o on o.id = rd.organization_id
      where o.name like 't026d-%'
    )
  `);
  await db.execute(sql`
    delete from jobs
    where target_entity_type = 'rag_document'
      and target_entity_id in (
        select rd.id
        from rag_documents rd
        join organizations o on o.id = rd.organization_id
        where o.name like 't026d-%'
      )
  `);
  await db.execute(sql`
    delete from rag_embeddings
    where chunk_id in (
      select rc.id
      from rag_chunks rc
      join rag_documents rd on rd.id = rc.document_id
      join organizations o on o.id = rd.organization_id
      where o.name like 't026d-%'
    )
  `);
  await db.execute(sql`
    delete from rag_chunks
    where document_id in (
      select rd.id
      from rag_documents rd
      join organizations o on o.id = rd.organization_id
      where o.name like 't026d-%'
    )
  `);
  await db.execute(sql`
    delete from rag_documents
    where organization_id in (select id from organizations where name like 't026d-%')
  `);
  await db.execute(sql`
    delete from research_fact_evidence
    where research_fact_id in (
      select rf.id
      from research_facts rf
      join research_snapshots rs on rs.id = rf.snapshot_id
      join organizations o on o.id = rs.organization_id
      where o.name like 't026d-%'
    )
  `);
  await db.execute(sql`
    delete from research_evidence
    where source_url like '%t026d-%'
  `);
  await db.execute(sql`
    delete from research_facts
    where snapshot_id in (
      select rs.id
      from research_snapshots rs
      join organizations o on o.id = rs.organization_id
      where o.name like 't026d-%'
    )
  `);
  await db.execute(sql`
    delete from research_snapshots
    where organization_id in (select id from organizations where name like 't026d-%')
  `);
  await db.execute(sql`
    delete from research_contact_candidates
    where organization_id in (select id from organizations where name like 't026d-%')
  `);
  await db.execute(sql`
    delete from agent_run_artifacts
    where agent_run_id in (
      select id from agent_runs where input_snapshot_json ->> 'test' = 't026d'
    )
  `);
  await db.execute(sql`
    delete from agent_run_events
    where agent_run_id in (
      select id from agent_runs where input_snapshot_json ->> 'test' = 't026d'
    )
  `);
  await db.execute(sql`
    delete from agent_runs where input_snapshot_json ->> 'test' = 't026d'
  `);
  await db.execute(sql`
    delete from organizations where name like 't026d-%'
  `);
}
