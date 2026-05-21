import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray, or, sql } from "drizzle-orm";
import { nonOverridableGuardrailCodes } from "@bizdev/shared";
import {
  approveDraftForSendCommand,
  campaigns,
  closeDb,
  commands,
  contacts,
  discardDraftCommand,
  draftClaims,
  draftFeedback,
  draftVersions,
  drafts,
  evaluatePreSendGuardrails,
  eventLog,
  getDb,
  jobs,
  markClaimResolvedCommand,
  organizations,
  outboundMessages,
  ragChunks,
  ragDocuments,
  ragEmbeddings,
  requestManualEditSaveCommand,
  workItems
} from "../src";

after(async () => {
  await closeDb();
});

test("readiness not_ready blocks approve as a hard pre-send failure", async (t) => {
  const db = getDb();
  await clearT013Artifacts();
  t.after(clearT013Artifacts);

  const fixture = await insertReviewFixture({ claims: [] });
  const result = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "operator@example.com"
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("approve should fail");
  assert.equal(result.failure.code, "autosend_readiness_not_ready");
});

test("operator can resolve a needs_review claim before approve", async (t) => {
  const db = getDb();
  await clearT013Artifacts();
  t.after(clearT013Artifacts);

  const fixture = await insertReviewFixture({
    claims: [{ text: "T013 claim needs operator support.", safety: "needs_review" }]
  });
  assert.ok(fixture.claimIds[0]);

  const before = await evaluatePreSendGuardrails({
    draftId: fixture.draftId,
    recipientEmail: fixture.email,
    contactId: fixture.contactId
  });
  assert.equal(before.failures.some((failure) => failure.code === "claim_safety_unresolved"), true);

  const resolved = await markClaimResolvedCommand({
    payload: {
      claimId: fixture.claimIds[0],
      draftVersion: 1,
      resolution: "manually_supported",
      note: "Operator verified the claim against the account research notes."
    }
  });
  assert.equal(resolved.ok, true);

  const [claim] = await db
    .select({ safety: draftClaims.safety })
    .from(draftClaims)
    .where(eq(draftClaims.id, fixture.claimIds[0]))
    .limit(1);
  assert.deepEqual(claim, { safety: "supported" });

  const approve = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "operator@example.com"
  });
  assert.equal(approve.ok, true);
});

test("minor manual edits preserve claim validation and skip revalidation job", async (t) => {
  const db = getDb();
  await clearT013Artifacts();
  t.after(clearT013Artifacts);

  const body = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
  const fixture = await insertReviewFixture({
    body,
    claims: [{ text: "T013 supported claim stays true after a small typo edit.", safety: "supported" }]
  });

  const result = await requestManualEditSaveCommand({
    payload: {
      draftId: fixture.draftId,
      expectedVersion: 1,
      subject: fixture.subject,
      body: `${body} thanks again soon`,
      notes: "Tiny copy edit."
    }
  });
  assert.equal(result.ok, true);

  const [draft] = await db
    .select({ version: drafts.version, claimsValidatedVersion: drafts.claimsValidatedVersion })
    .from(drafts)
    .where(eq(drafts.id, fixture.draftId))
    .limit(1);
  assert.deepEqual(draft, { version: 2, claimsValidatedVersion: 2 });

  const [version] = await db
    .select({
      claimsValidatedVersion: draftVersions.claimsValidatedVersion,
      editSeverity: draftVersions.editSeverity
    })
    .from(draftVersions)
    .where(sql`${draftVersions.draftId} = ${fixture.draftId} and ${draftVersions.version} = 2`)
    .limit(1);
  assert.equal(version?.claimsValidatedVersion, 2);
  assert.equal(version?.editSeverity, "minor");

  const revalidationJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(sql`${jobs.targetEntityId} = ${fixture.draftId} and ${jobs.jobType} = 'job.revalidate_draft_claims'`);
  assert.equal(revalidationJobs.length, 0);
});

test("claims_no_org_context is non-overridable", async (t) => {
  const db = getDb();
  await clearT013Artifacts();
  t.after(clearT013Artifacts);

  const [draft] = await db
    .insert(drafts)
    .values({
      subject: "T013 no org context",
      body: "T013 body with a claim but no organization context.",
      status: "draft",
      version: 1,
      claimsValidatedVersion: null
    })
    .returning({ id: drafts.id });
  assert.ok(draft);
  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject: "T013 no org context",
    body: "T013 body with a claim but no organization context.",
    bodyHash: "t013-no-org",
    claimsValidatedVersion: null,
    source: "operator_created"
  });

  const guardrails = await evaluatePreSendGuardrails({
    draftId: draft.id,
    recipientEmail: "t013-no-org@example.com"
  });
  assert.equal(guardrails.failures.some((failure) => failure.code === "claims_no_org_context"), true);
  assert.equal((nonOverridableGuardrailCodes as readonly string[]).includes("claims_no_org_context"), true);
});

test("discard draft closes review work item and prevents approve", async (t) => {
  const db = getDb();
  await clearT013Artifacts();
  t.after(clearT013Artifacts);

  const fixture = await insertReviewFixture({
    claims: [{ text: "T013 supported claim before discard.", safety: "supported" }],
    withReviewWorkItem: true
  });

  const discarded = await discardDraftCommand({
    payload: {
      draftId: fixture.draftId,
      expectedVersion: 1,
      reason: "Operator rejected this draft angle."
    }
  });
  assert.equal(discarded.ok, true);

  const [draft] = await db
    .select({ status: drafts.status, autosendReadiness: drafts.autosendReadiness })
    .from(drafts)
    .where(eq(drafts.id, fixture.draftId))
    .limit(1);
  assert.deepEqual(draft, { status: "discarded", autosendReadiness: "not_ready" });

  const [workItem] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.draftId, fixture.draftId))
    .limit(1);
  assert.deepEqual(workItem, { status: "resolved" });

  const [feedback] = await db
    .select({ kind: draftFeedback.kind, note: draftFeedback.note })
    .from(draftFeedback)
    .where(eq(draftFeedback.draftId, fixture.draftId))
    .limit(1);
  assert.deepEqual(feedback, { kind: "discard", note: "Operator rejected this draft angle." });

  const approve = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "operator@example.com"
  });
  assert.equal(approve.ok, false);
  if (approve.ok) assert.fail("discarded draft should not approve");
  assert.equal(approve.failure.code, "draft_not_sendable");
});

async function insertReviewFixture(input: {
  subject?: string;
  body?: string;
  claims: Array<{ text: string; safety: "supported" | "needs_review" }>;
  withReviewWorkItem?: boolean;
}): Promise<{
  organizationId: string;
  campaignId: string;
  contactId: string;
  draftId: string;
  claimIds: string[];
  email: string;
  subject: string;
}> {
  const db = getDb();
  const suffix = randomUUID();
  const email = `t013-${suffix}@example.com`;
  const [organization] = await db
    .insert(organizations)
    .values({ name: `t013-org-${suffix}`, domain: `t013-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t013-campaign-${suffix}`,
      status: "active",
      objective: "Review Step 7 operator safety.",
      targetSegments: ["T013"],
      operatorNotes: null
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, email, fullName: "T013 Reviewer" })
    .returning({ id: contacts.id });
  assert.ok(contact);

  const subject = input.subject ?? `T013 subject ${suffix}`;
  const body = input.body ?? "T013 reviewed body with enough context for operator review.";
  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: campaign.id,
      contactId: contact.id,
      version: 1,
      subject,
      body,
      status: "draft",
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject,
    body,
    bodyHash: `t013-${suffix}`,
    claimsValidatedVersion: 1,
    source: "agent_generated"
  });

  const claimIds: string[] = [];
  for (const claim of input.claims) {
    const [row] = await db
      .insert(draftClaims)
      .values({
        draftId: draft.id,
        claimText: claim.text,
        safety: claim.safety
      })
      .returning({ id: draftClaims.id });
    assert.ok(row);
    claimIds.push(row.id);
  }

  if (input.withReviewWorkItem) {
    await db.insert(workItems).values({
      type: "draft_review_pending",
      priority: 70,
      sourceEntityType: "draft",
      sourceEntityId: draft.id,
      title: `Review T013 draft ${suffix}`,
      reasonCode: "test_review",
      actionLabel: "Review draft",
      dedupeKey: `t013-review:${draft.id}`,
      draftId: draft.id,
      campaignId: campaign.id
    });
  }

  return {
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    draftId: draft.id,
    claimIds,
    email,
    subject
  };
}

async function clearT013Artifacts() {
  const db = getDb();
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.name} like 't013-%'`);
  const orgIds = orgRows.map((row) => row.id);

  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.name} like 't013-%'`);
  const campaignIds = campaignRows.map((row) => row.id);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.email} like 't013-%'`);
  const contactIds = contactRows.map((row) => row.id);

  const draftRows = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(or(
      sql`${drafts.subject} like 'T013%'`,
      ...(contactIds.length > 0 ? [inArray(drafts.contactId, contactIds)] : []),
      ...(campaignIds.length > 0 ? [inArray(drafts.campaignId, campaignIds)] : [])
    ));
  const draftIds = draftRows.map((row) => row.id);

  const claimRows = draftIds.length > 0
    ? await db.select({ id: draftClaims.id }).from(draftClaims).where(inArray(draftClaims.draftId, draftIds))
    : [];
  const claimIds = claimRows.map((row) => row.id);

  const draftVersionRows = draftIds.length > 0
    ? await db.select({ id: draftVersions.id }).from(draftVersions).where(inArray(draftVersions.draftId, draftIds))
    : [];
  const draftVersionIds = draftVersionRows.map((row) => row.id);

  const outboundRows = draftIds.length > 0
    ? await db.select({ id: outboundMessages.id }).from(outboundMessages).where(inArray(outboundMessages.draftId, draftIds))
    : [];
  const outboundIds = outboundRows.map((row) => row.id);

  const ragDocumentRows = orgIds.length > 0 || draftIds.length > 0 || draftVersionIds.length > 0
    ? await db
        .select({ id: ragDocuments.id })
        .from(ragDocuments)
        .where(or(
          ...(orgIds.length > 0 ? [inArray(ragDocuments.organizationId, orgIds)] : []),
          ...(draftIds.length > 0 ? [inArray(ragDocuments.sourceEntityId, draftIds)] : []),
          ...(draftVersionIds.length > 0 ? [inArray(ragDocuments.sourceEntityId, draftVersionIds)] : [])
        ))
    : [];
  const ragDocumentIds = ragDocumentRows.map((row) => row.id);

  const jobRows = draftIds.length > 0 || outboundIds.length > 0 || ragDocumentIds.length > 0
    ? await db
        .select({ id: jobs.id, commandId: jobs.commandId })
        .from(jobs)
        .where(or(
          ...(draftIds.length > 0 ? [inArray(jobs.targetEntityId, draftIds)] : []),
          ...(outboundIds.length > 0 ? [inArray(jobs.targetEntityId, outboundIds)] : []),
          ...(ragDocumentIds.length > 0 ? [inArray(jobs.targetEntityId, ragDocumentIds)] : [])
        ))
    : [];
  const jobIds = jobRows.map((row) => row.id);
  const jobCommandIds = jobRows.map((row) => row.commandId).filter((id): id is string => Boolean(id));

  const commandRows = draftIds.length > 0 || claimIds.length > 0 || outboundIds.length > 0 || jobCommandIds.length > 0
    ? await db
        .select({ id: commands.id })
        .from(commands)
        .where(or(
          ...(draftIds.length > 0 ? [inArray(commands.targetEntityId, draftIds)] : []),
          ...(claimIds.length > 0 ? [inArray(commands.targetEntityId, claimIds)] : []),
          ...(outboundIds.length > 0 ? [inArray(commands.targetEntityId, outboundIds)] : []),
          ...(jobCommandIds.length > 0 ? [inArray(commands.id, jobCommandIds)] : [])
        ))
    : [];
  const commandIds = commandRows.map((row) => row.id);

  const eventEntityIds = [
    ...orgIds,
    ...campaignIds,
    ...contactIds,
    ...draftIds,
    ...draftVersionIds,
    ...claimIds,
    ...outboundIds,
    ...ragDocumentIds,
    ...jobIds
  ];
  if (eventEntityIds.length > 0 || commandIds.length > 0 || jobIds.length > 0) {
    await db.delete(eventLog).where(or(
      ...(eventEntityIds.length > 0 ? [inArray(eventLog.entityId, eventEntityIds)] : []),
      ...(commandIds.length > 0 ? [inArray(eventLog.commandId, commandIds)] : []),
      ...(jobIds.length > 0 ? [inArray(eventLog.jobId, jobIds)] : [])
    ));
  }

  if (draftIds.length > 0) {
    await db.delete(draftFeedback).where(inArray(draftFeedback.draftId, draftIds));
    await db.delete(workItems).where(inArray(workItems.draftId, draftIds));
  }
  if (jobIds.length > 0) await db.delete(jobs).where(inArray(jobs.id, jobIds));
  if (ragDocumentIds.length > 0) {
    const ragChunkRows = await db
      .select({ id: ragChunks.id })
      .from(ragChunks)
      .where(inArray(ragChunks.documentId, ragDocumentIds));
    const ragChunkIds = ragChunkRows.map((row) => row.id);
    if (ragChunkIds.length > 0) await db.delete(ragEmbeddings).where(inArray(ragEmbeddings.chunkId, ragChunkIds));
    await db.delete(ragChunks).where(inArray(ragChunks.documentId, ragDocumentIds));
    await db.delete(ragDocuments).where(inArray(ragDocuments.id, ragDocumentIds));
  }
  if (outboundIds.length > 0) await db.delete(outboundMessages).where(inArray(outboundMessages.id, outboundIds));
  if (claimIds.length > 0) await db.delete(draftClaims).where(inArray(draftClaims.id, claimIds));
  if (draftIds.length > 0) {
    await db.delete(draftVersions).where(inArray(draftVersions.draftId, draftIds));
    await db.delete(drafts).where(inArray(drafts.id, draftIds));
  }
  if (commandIds.length > 0) await db.delete(commands).where(inArray(commands.id, commandIds));
  if (contactIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, contactIds));
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
