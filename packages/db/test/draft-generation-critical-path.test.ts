import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  agentRunArtifacts,
  agentRunEvents,
  agentRuns,
  campaigns,
  closeDb,
  completeGenerateDraftJob,
  contacts,
  draftClaimFactRefs,
  draftClaims,
  drafts,
  draftVersions,
  eventLog,
  getDb,
  jobRuns,
  jobs,
  organizations,
  researchEvidence,
  researchFactEvidence,
  researchFacts,
  researchSnapshots,
  routeResearchSnapshotOutcome,
  suppressionEntries,
  workItems,
  type AgentStageDispatcher,
  type LeasedJob
} from "../src";

after(async () => {
  await closeDb();
});

test("cold draft generation uses campaign context, safe facts, claim revalidation, and suppression pre-check", async (t) => {
  const db = getDb();
  await clearT012Artifacts();
  t.after(clearT012Artifacts);

  const suffix = randomUUID();
  const email = `t012-${suffix}@example.com`;
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t012-org-${suffix}`,
      domain: `t012-${suffix}.example`
    })
    .returning({ id: organizations.id, name: organizations.name });
  assert.ok(organization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t012-campaign-${suffix}`,
      objective: "Book security-platform discovery calls with regulated fintech teams.",
      targetSegments: ["US fintech", "Series B security leaders"],
      operatorNotes: "Lead with verified compliance automation pain."
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({
      organizationId: organization.id,
      email,
      fullName: "Tessa Operator"
    })
    .returning({ id: contacts.id, email: contacts.email });
  assert.ok(contact);

  const [snapshot] = await db
    .insert(researchSnapshots)
    .values({
      organizationId: organization.id,
      snapshotVersion: 1,
      status: "completed"
    })
    .returning({ id: researchSnapshots.id });
  assert.ok(snapshot);

  const [safeFact, unsafeFact] = await db
    .insert(researchFacts)
    .values([
      {
        snapshotId: snapshot.id,
        factText: "T012 SafeCo reports SOC2 automation for fintech onboarding.",
        status: "active",
        confidence: 95,
        safeForCopy: true
      },
      {
        snapshotId: snapshot.id,
        factText: "T012 unsafe rumor should not enter the cold draft prompt.",
        status: "active",
        confidence: 99,
        safeForCopy: false
      }
    ])
    .returning({ id: researchFacts.id, factText: researchFacts.factText });
  assert.ok(safeFact);
  assert.ok(unsafeFact);

  await db.insert(suppressionEntries).values({
    email: email.toLowerCase(),
    reason: "unsubscribe",
    source: "test",
    active: true
  });

  const suppressedJob = await createRunningDraftJob({
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    operatorBrief: "Write a cold intro."
  });
  let suppressedDispatchCalled = false;
  const suppressedDispatcher: AgentStageDispatcher = async function* () {
    suppressedDispatchCalled = true;
  };

  await completeGenerateDraftJob({
    ...suppressedJob,
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    operatorBrief: "Write a cold intro.",
    dispatcher: suppressedDispatcher
  });

  assert.equal(suppressedDispatchCalled, false);
  const [suppressedStatus] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, suppressedJob.job.id))
    .limit(1);
  assert.deepEqual(suppressedStatus, { status: "succeeded" });
  const [suppressedEvent] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(eq(eventLog.eventType, "draft_email_aborted_suppressed"))
    .limit(1);
  assert.equal(suppressedEvent?.payloadJson["suppressionId"] ? true : false, true);

  await db
    .update(suppressionEntries)
    .set({ active: false })
    .where(eq(suppressionEntries.email, email.toLowerCase()));

  const generatedJob = await createRunningDraftJob({
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    operatorBrief: "Write a cold intro."
  });
  let capturedPrompt = "";
  const dispatcher: AgentStageDispatcher = async function* ({ prompt }) {
    capturedPrompt = prompt;
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({
          subject: "Security automation intro",
          body: "Hi Tessa,\nSaw your SOC2 automation work for fintech onboarding.",
          claims: [
            {
              claimText: "T012 SafeCo reports SOC2 automation for fintech onboarding.",
              factIds: [safeFact.id],
              supportType: "supports"
            }
          ]
        })
      }
    };
  };

  await completeGenerateDraftJob({
    ...generatedJob,
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    operatorBrief: "Write a cold intro.",
    dispatcher
  });

  assert.match(capturedPrompt, /<campaign_context>/);
  assert.match(capturedPrompt, /Book security-platform discovery calls/);
  assert.match(capturedPrompt, /T012 SafeCo reports SOC2 automation/);
  assert.doesNotMatch(capturedPrompt, /unsafe rumor/);

  const [draft] = await db
    .select({
      id: drafts.id,
      claimsValidatedVersion: drafts.claimsValidatedVersion
    })
    .from(drafts)
    .where(eq(drafts.contactId, contact.id))
    .orderBy(desc(drafts.createdAt))
    .limit(1);
  assert.ok(draft);
  assert.equal(draft.claimsValidatedVersion, 0);

  const [version] = await db
    .select({ claimsValidatedVersion: draftVersions.claimsValidatedVersion })
    .from(draftVersions)
    .where(eq(draftVersions.draftId, draft.id))
    .limit(1);
  assert.deepEqual(version, { claimsValidatedVersion: 0 });

  const [revalidationJob] = await db
    .select({
      jobType: jobs.jobType,
      status: jobs.status,
      payloadJson: jobs.payloadJson
    })
    .from(jobs)
    .where(andJobTarget(draft.id, "job.revalidate_draft_claims"))
    .limit(1);
  assert.equal(revalidationJob?.jobType, "job.revalidate_draft_claims");
  assert.equal(revalidationJob?.status, "queued");
  assert.equal(revalidationJob?.payloadJson["expectedVersion"], 1);
  assert.equal(revalidationJob?.payloadJson["organizationId"], organization.id);

  const claimRows = await db
    .select({ id: draftClaims.id, safety: draftClaims.safety })
    .from(draftClaims)
    .where(eq(draftClaims.draftId, draft.id));
  assert.equal(claimRows.length, 1);
  assert.equal(claimRows[0]?.safety, "supported");
});

test("research snapshot auto-promotes copy-safe facts for cold draft grounding", async (t) => {
  const db = getDb();
  await clearT012Artifacts();
  t.after(clearT012Artifacts);

  const suffix = randomUUID();
  const domain = `t012-autopromote-${suffix}.example`;
  const email = `t012-autopromote-${suffix}@example.com`;
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t012-autopromote-org-${suffix}`,
      domain
    })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t012-autopromote-campaign-${suffix}`,
      objective: "Book meetings with fintech compliance teams.",
      targetSegments: ["Fintech compliance"],
      operatorNotes: null
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({
      organizationId: organization.id,
      email,
      fullName: "Ari Reviewer"
    })
    .returning({ id: contacts.id });
  assert.ok(contact);

  const safeClaim = "T012 AutoPromoteCo documents SOC 2 automation for fintech onboarding.";
  const unsafeClaim = "T012 single-source claim should not enter cold draft grounding.";
  const refutedClaim = "T012 refuted claim should not enter cold draft grounding.";
  const routerResult = await routeResearchSnapshotOutcome({
    agentRunId: randomUUID(),
    organizationId: organization.id,
    correlationId: randomUUID(),
    finalText: JSON.stringify({
      facts: [
        {
          claim: safeClaim,
          confidence: "high",
          evidence: [
            {
              sourceUrl: `https://${domain}/security/soc2`,
              sourceType: "url_fetch",
              quoteText: "SOC 2 automation for fintech onboarding.",
              supportType: "supports"
            },
            {
              sourceUrl: "https://www.sec.gov/Archives/edgar/t012-autopromote",
              sourceType: "search_result",
              quoteText: "Independent filing evidence.",
              supportType: "supports"
            }
          ]
        },
        {
          claim: unsafeClaim,
          confidence: "high",
          evidence: [
            {
              sourceUrl: "https://unknown-source.example/post",
              sourceType: "search_result",
              quoteText: "Only one source.",
              supportType: "supports"
            }
          ]
        },
        {
          claim: refutedClaim,
          confidence: "high",
          evidence: [
            {
              sourceUrl: `https://${domain}/blog/refuted`,
              sourceType: "url_fetch",
              quoteText: "Refutes the claim.",
              supportType: "refutes"
            },
            {
              sourceUrl: "https://www.sec.gov/Archives/edgar/t012-refuted",
              sourceType: "search_result",
              quoteText: "Also refutes the claim.",
              supportType: "refutes"
            }
          ]
        }
      ],
      contactCandidates: []
    })
  });
  assert.equal(routerResult?.factCount, 3);

  const [snapshot] = await db
    .select({ id: researchSnapshots.id })
    .from(researchSnapshots)
    .where(eq(researchSnapshots.organizationId, organization.id))
    .limit(1);
  assert.ok(snapshot);

  const factRows = await db
    .select({
      id: researchFacts.id,
      factText: researchFacts.factText,
      status: researchFacts.status,
      safeForCopy: researchFacts.safeForCopy
    })
    .from(researchFacts)
    .where(eq(researchFacts.snapshotId, snapshot.id));
  const promotedFact = factRows.find((fact) => fact.factText === safeClaim);
  assert.ok(promotedFact);
  assert.equal(promotedFact.status, "active");
  assert.equal(promotedFact.safeForCopy, true);

  for (const fact of factRows.filter((row) => row.factText !== safeClaim)) {
    assert.equal(fact.status, "proposed");
    assert.equal(fact.safeForCopy, false);
  }

  const [snapshotEvent] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(eq(eventLog.entityId, snapshot.id))
    .limit(1);
  assert.equal(snapshotEvent?.payloadJson["safeForCopyFactCount"], 1);

  const generatedJob = await createRunningDraftJob({
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    operatorBrief: "Write a grounded cold intro."
  });
  let capturedPrompt = "";
  const dispatcher: AgentStageDispatcher = async function* ({ prompt }) {
    capturedPrompt = prompt;
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({
          subject: "SOC 2 automation intro",
          body: "Hi Ari,\nSaw your SOC 2 automation work for fintech onboarding.",
          claims: [
            {
              claimText: safeClaim,
              factIds: [promotedFact.id],
              supportType: "supports"
            }
          ]
        })
      }
    };
  };

  await completeGenerateDraftJob({
    ...generatedJob,
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    operatorBrief: "Write a grounded cold intro.",
    dispatcher
  });

  assert.match(capturedPrompt, /T012 AutoPromoteCo documents SOC 2 automation/);
  assert.doesNotMatch(capturedPrompt, /single-source claim/);
  assert.doesNotMatch(capturedPrompt, /refuted claim/);
});

async function createRunningDraftJob(input: {
  organizationId: string;
  campaignId: string;
  contactId: string;
  operatorBrief: string;
}): Promise<{ job: LeasedJob; runId: string; workerId: string }> {
  const db = getDb();
  const jobId = randomUUID();
  const runId = randomUUID();
  const workerId = `t012-worker-${randomUUID()}`;
  const correlationId = randomUUID();
  const payloadJson = {
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    contactId: input.contactId,
    operatorBrief: input.operatorBrief
  };

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.generate_cold_draft",
    status: "running",
    workerPool: "drafting",
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
      job_type: "job.generate_cold_draft",
      command_id: null,
      payload_json: payloadJson,
      attempts: 1,
      max_attempts: 3,
      correlation_id: correlationId
    }
  };
}

function andJobTarget(targetEntityId: string, jobType: string) {
  return sql`${jobs.targetEntityId} = ${targetEntityId} and ${jobs.jobType} = ${jobType}`;
}

async function clearT012Artifacts() {
  const db = getDb();
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.name} like 't012-%'`);
  const orgIds = orgRows.map((row) => row.id);

  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.name} like 't012-%'`);
  const campaignIds = campaignRows.map((row) => row.id);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.email} like 't012-%'`);
  const contactIds = contactRows.map((row) => row.id);

  const snapshotRows = orgIds.length > 0
    ? await db
        .select({ id: researchSnapshots.id })
        .from(researchSnapshots)
        .where(inArray(researchSnapshots.organizationId, orgIds))
    : [];
  const snapshotIds = snapshotRows.map((row) => row.id);
  const factRows = snapshotIds.length > 0
    ? await db
        .select({ id: researchFacts.id })
        .from(researchFacts)
        .where(inArray(researchFacts.snapshotId, snapshotIds))
    : [];
  const factIds = factRows.map((row) => row.id);
  const factEvidenceRows = factIds.length > 0
    ? await db
        .select({ evidenceId: researchFactEvidence.researchEvidenceId })
        .from(researchFactEvidence)
        .where(inArray(researchFactEvidence.researchFactId, factIds))
    : [];
  const evidenceIds = factEvidenceRows.map((row) => row.evidenceId);

  const draftRows = contactIds.length > 0 || campaignIds.length > 0
    ? await db
        .select({ id: drafts.id })
        .from(drafts)
        .where(or(
          ...(contactIds.length > 0 ? [inArray(drafts.contactId, contactIds)] : []),
          ...(campaignIds.length > 0 ? [inArray(drafts.campaignId, campaignIds)] : [])
        ))
    : [];
  const draftIds = draftRows.map((row) => row.id);

  const jobRows = orgIds.length > 0 || draftIds.length > 0
    ? await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(or(
          ...(orgIds.length > 0 ? [inArray(jobs.targetEntityId, orgIds)] : []),
          ...(draftIds.length > 0 ? [inArray(jobs.targetEntityId, draftIds)] : [])
        ))
    : [];
  const jobIds = jobRows.map((row) => row.id);

  const agentRunRows = jobIds.length > 0
    ? await db.select({ id: agentRuns.id }).from(agentRuns).where(inArray(agentRuns.jobId, jobIds))
    : [];
  const agentRunIds = agentRunRows.map((row) => row.id);

  const claimRows = draftIds.length > 0
    ? await db.select({ id: draftClaims.id }).from(draftClaims).where(inArray(draftClaims.draftId, draftIds))
    : [];
  const claimIds = claimRows.map((row) => row.id);

  if (agentRunIds.length > 0) {
    await db.delete(agentRunArtifacts).where(inArray(agentRunArtifacts.agentRunId, agentRunIds));
    await db.delete(agentRunEvents).where(inArray(agentRunEvents.agentRunId, agentRunIds));
  }
  if (jobIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.jobId, jobIds));
  }
  if (draftIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.entityId, draftIds));
    await db.delete(workItems).where(inArray(workItems.draftId, draftIds));
  }
  if (snapshotIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.entityId, snapshotIds));
  }
  if (claimIds.length > 0) {
    await db.delete(draftClaimFactRefs).where(inArray(draftClaimFactRefs.draftClaimId, claimIds));
    await db.delete(draftClaims).where(inArray(draftClaims.id, claimIds));
  }
  if (draftIds.length > 0) {
    await db.delete(draftVersions).where(inArray(draftVersions.draftId, draftIds));
    await db.delete(drafts).where(inArray(drafts.id, draftIds));
  }
  if (agentRunIds.length > 0) {
    await db.delete(agentRuns).where(inArray(agentRuns.id, agentRunIds));
  }
  if (jobIds.length > 0) {
    await db.delete(jobRuns).where(inArray(jobRuns.jobId, jobIds));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  }
  if (factIds.length > 0) {
    await db.delete(researchFactEvidence).where(inArray(researchFactEvidence.researchFactId, factIds));
  }
  if (evidenceIds.length > 0) {
    await db.delete(researchEvidence).where(inArray(researchEvidence.id, evidenceIds));
  }
  if (snapshotIds.length > 0) {
    await db.delete(researchFacts).where(inArray(researchFacts.snapshotId, snapshotIds));
    await db.delete(researchSnapshots).where(inArray(researchSnapshots.id, snapshotIds));
  }
  await db.delete(suppressionEntries).where(sql`${suppressionEntries.email} like 't012-%'`);
  if (contactIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, contactIds));
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
