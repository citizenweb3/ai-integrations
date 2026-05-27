import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  approveContactCandidateCommand,
  closeDb,
  contacts,
  eventLog,
  generateDraftCommand,
  getDb,
  getOrganizationDetail,
  organizations,
  researchContactCandidates,
  setPrimaryContactCommand,
  suppressionEntries
} from "../src";

after(async () => {
  await closeDb();
});

test("approveContactCandidateCommand refuses actively suppressed emails", async (t) => {
  const db = getDb();
  await clearT026Artifacts();
  t.after(clearT026Artifacts);

  const suffix = randomUUID();
  const email = `t026-suppressed-${suffix}@example.com`;
  const [organization] = await db
    .insert(organizations)
    .values({ name: `t026-suppressed-org-${suffix}`, domain: `t026-suppressed-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [candidate] = await db
    .insert(researchContactCandidates)
    .values({
      organizationId: organization.id,
      email,
      fullName: "T026 Suppressed",
      role: "VP Security",
      status: "pending"
    })
    .returning({ id: researchContactCandidates.id });
  assert.ok(candidate);

  await db.insert(suppressionEntries).values({
    email,
    reason: "unsubscribe",
    source: "test",
    active: true
  });

  const result = await approveContactCandidateCommand({
    payload: { candidateId: candidate.id }
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("suppressed candidate should not approve");
  assert.equal(result.failure.code, "email_suppressed");

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, email));
  assert.equal(contactRows.length, 0);

  const [candidateAfter] = await db
    .select({ status: researchContactCandidates.status, convertedContactId: researchContactCandidates.convertedContactId })
    .from(researchContactCandidates)
    .where(eq(researchContactCandidates.id, candidate.id))
    .limit(1);
  assert.deepEqual(candidateAfter, { status: "pending", convertedContactId: null });
});

test("approveContactCandidateCommand sets the organization primary contact on first promotion only", async (t) => {
  const db = getDb();
  await clearT026Artifacts();
  t.after(clearT026Artifacts);

  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({ name: `t026-primary-org-${suffix}`, domain: `t026-primary-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const firstEmail = `t026-primary-first-${suffix}@example.com`;
  const secondEmail = `t026-primary-second-${suffix}@example.com`;
  const [firstCandidate, secondCandidate] = await db
    .insert(researchContactCandidates)
    .values([
      {
        organizationId: organization.id,
        email: firstEmail,
        fullName: "T026 Primary",
        role: "CISO",
        status: "pending"
      },
      {
        organizationId: organization.id,
        email: secondEmail,
        fullName: "T026 Secondary",
        role: "Director",
        status: "pending"
      }
    ])
    .returning({ id: researchContactCandidates.id });
  assert.ok(firstCandidate);
  assert.ok(secondCandidate);

  const first = await approveContactCandidateCommand({
    payload: { candidateId: firstCandidate.id }
  });
  assert.equal(first.ok, true);
  if (!first.ok) assert.fail(first.failure.message);

  const [afterFirst] = await db
    .select({ primaryContactId: organizations.primaryContactId })
    .from(organizations)
    .where(eq(organizations.id, organization.id))
    .limit(1);
  assert.deepEqual(afterFirst, { primaryContactId: first.contactId });

  const second = await approveContactCandidateCommand({
    payload: { candidateId: secondCandidate.id }
  });
  assert.equal(second.ok, true);
  if (!second.ok) assert.fail(second.failure.message);

  const [afterSecond] = await db
    .select({ primaryContactId: organizations.primaryContactId })
    .from(organizations)
    .where(eq(organizations.id, organization.id))
    .limit(1);
  assert.deepEqual(afterSecond, { primaryContactId: first.contactId });
});

test("setPrimaryContactCommand lets an operator change the organization primary contact", async (t) => {
  const db = getDb();
  await clearT026Artifacts();
  t.after(clearT026Artifacts);

  const suffix = randomUUID();
  const [organization, otherOrganization] = await db
    .insert(organizations)
    .values([
      { name: `t026-set-primary-org-${suffix}`, domain: `t026-set-primary-${suffix}.example` },
      { name: `t026-set-primary-other-org-${suffix}`, domain: `t026-set-primary-other-${suffix}.example` }
    ])
    .returning({ id: organizations.id });
  assert.ok(organization);
  assert.ok(otherOrganization);

  const [firstContact, secondContact, otherContact] = await db
    .insert(contacts)
    .values([
      {
        organizationId: organization.id,
        email: `t026-set-primary-first-${suffix}@example.com`,
        fullName: "T026 Set Primary First"
      },
      {
        organizationId: organization.id,
        email: `t026-set-primary-second-${suffix}@example.com`,
        fullName: "T026 Set Primary Second"
      },
      {
        organizationId: otherOrganization.id,
        email: `t026-set-primary-other-${suffix}@example.com`,
        fullName: "T026 Set Primary Other"
      }
    ])
    .returning({ id: contacts.id });
  assert.ok(firstContact);
  assert.ok(secondContact);
  assert.ok(otherContact);

  const first = await setPrimaryContactCommand({
    payload: {
      organizationId: organization.id,
      contactId: firstContact.id,
      reasonText: "T026 initial primary"
    }
  });
  assert.equal(first.ok, true);
  if (!first.ok) assert.fail(first.failure.message);
  assert.equal(first.changed, true);
  assert.equal(first.previousContactId, null);
  assert.match(first.idempotencyKey, /^set_primary_contact:/);

  const replay = await setPrimaryContactCommand({
    payload: {
      organizationId: organization.id,
      contactId: firstContact.id,
      idempotencyKey: first.idempotencyKey
    }
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) assert.fail(replay.failure.message);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.command.id, first.command.id);

  const second = await setPrimaryContactCommand({
    payload: {
      organizationId: organization.id,
      contactId: secondContact.id,
      reasonText: "T026 better fit"
    }
  });
  assert.equal(second.ok, true);
  if (!second.ok) assert.fail(second.failure.message);
  assert.equal(second.changed, true);
  assert.equal(second.previousContactId, firstContact.id);

  const [afterSecond] = await db
    .select({ primaryContactId: organizations.primaryContactId })
    .from(organizations)
    .where(eq(organizations.id, organization.id))
    .limit(1);
  assert.deepEqual(afterSecond, { primaryContactId: secondContact.id });

  const mismatch = await setPrimaryContactCommand({
    payload: {
      organizationId: organization.id,
      contactId: otherContact.id
    }
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) assert.fail("cross-org contact should fail");
  assert.equal(mismatch.failure.code, "contact_not_for_organization");

  const detail = await getOrganizationDetail(organization.id);
  assert.ok(detail);
  assert.equal(detail.primaryContactId, secondContact.id);
  assert.equal(detail.contacts.find((contact) => contact.id === secondContact.id)?.isPrimary, true);
  assert.equal(detail.contacts.find((contact) => contact.id === firstContact.id)?.isPrimary, false);

  const primaryEvents = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(eq(eventLog.eventType, "organization_primary_contact_set"));
  assert.equal(primaryEvents.filter((row) => row.payloadJson["organizationId"] === organization.id).length, 2);
});

test("generateDraftCommand requires an organization contact and resolves primary contact", async (t) => {
  const db = getDb();
  await clearT026Artifacts();
  t.after(clearT026Artifacts);

  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({ name: `t026-draft-org-${suffix}`, domain: `t026-draft-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const noContact = await generateDraftCommand({
    payload: {
      organizationId: organization.id,
      operatorBrief: "T026 no-contact draft",
      idempotencyKey: `t026-no-contact-${suffix}`
    }
  });
  assert.equal(noContact.ok, false);
  if (noContact.ok) assert.fail("draft without org contact should fail");
  assert.equal(noContact.failure.code, "no_contact_for_organization");

  const [fallbackContact] = await db
    .insert(contacts)
    .values({
      organizationId: organization.id,
      email: `t026-draft-fallback-${suffix}@example.com`,
      fullName: "T026 Fallback"
    })
    .returning({ id: contacts.id });
  assert.ok(fallbackContact);

  const fallbackDraft = await generateDraftCommand({
    payload: {
      organizationId: organization.id,
      operatorBrief: "T026 fallback-contact draft",
      idempotencyKey: `t026-fallback-${suffix}`
    }
  });
  assert.equal(fallbackDraft.ok, true);
  if (!fallbackDraft.ok) assert.fail(fallbackDraft.failure.message);
  assert.equal(fallbackDraft.job.payloadJson["contactId"], fallbackContact.id);

  const [primaryContact] = await db
    .insert(contacts)
    .values({
      organizationId: organization.id,
      email: `t026-draft-primary-${suffix}@example.com`,
      fullName: "T026 Primary"
    })
    .returning({ id: contacts.id });
  assert.ok(primaryContact);
  await db
    .update(organizations)
    .set({ primaryContactId: primaryContact.id })
    .where(eq(organizations.id, organization.id));

  const primaryDraft = await generateDraftCommand({
    payload: {
      organizationId: organization.id,
      operatorBrief: "T026 primary-contact draft",
      idempotencyKey: `t026-primary-${suffix}`
    }
  });
  assert.equal(primaryDraft.ok, true);
  if (!primaryDraft.ok) assert.fail(primaryDraft.failure.message);
  assert.equal(primaryDraft.job.payloadJson["contactId"], primaryContact.id);

  const [otherOrganization] = await db
    .insert(organizations)
    .values({ name: `t026-other-org-${suffix}`, domain: `t026-other-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(otherOrganization);
  const [otherContact] = await db
    .insert(contacts)
    .values({
      organizationId: otherOrganization.id,
      email: `t026-other-${suffix}@example.com`,
      fullName: "T026 Other"
    })
    .returning({ id: contacts.id });
  assert.ok(otherContact);

  const mismatch = await generateDraftCommand({
    payload: {
      organizationId: organization.id,
      contactId: otherContact.id,
      operatorBrief: "T026 mismatch draft",
      idempotencyKey: `t026-mismatch-${suffix}`
    }
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) assert.fail("cross-org contact should fail");
  assert.equal(mismatch.failure.code, "contact_not_for_organization");
});

async function clearT026Artifacts(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    DELETE FROM event_log
    WHERE payload_json::text LIKE '%t026-%'
       OR command_id IN (
         SELECT id FROM commands
         WHERE target_entity_id IN (
           SELECT id FROM research_contact_candidates WHERE email LIKE 't026-%'
           UNION
           SELECT id FROM organizations WHERE name LIKE 't026-%'
         )
       )
       OR job_id IN (
         SELECT id FROM jobs
         WHERE target_entity_id IN (SELECT id FROM organizations WHERE name LIKE 't026-%')
            OR payload_json::text LIKE '%t026-%'
       )
  `);
  await db.execute(sql`
    DELETE FROM jobs
    WHERE target_entity_id IN (SELECT id FROM organizations WHERE name LIKE 't026-%')
       OR payload_json::text LIKE '%t026-%'
       OR command_id IN (
         SELECT id FROM commands
         WHERE target_entity_id IN (
           SELECT id FROM research_contact_candidates WHERE email LIKE 't026-%'
           UNION
           SELECT id FROM organizations WHERE name LIKE 't026-%'
         )
       )
  `);
  await db.execute(sql`
    DELETE FROM commands
    WHERE payload_json::text LIKE '%t026-%'
       OR target_entity_id IN (
         SELECT id FROM research_contact_candidates WHERE email LIKE 't026-%'
         UNION
         SELECT id FROM organizations WHERE name LIKE 't026-%'
       )
  `);
  await db.execute(sql`UPDATE organizations SET primary_contact_id = NULL WHERE name LIKE 't026-%'`);
  await db.execute(sql`DELETE FROM research_contact_candidates WHERE email LIKE 't026-%'`);
  await db.execute(sql`DELETE FROM suppression_entries WHERE email LIKE 't026-%'`);
  await db.execute(sql`DELETE FROM contacts WHERE email LIKE 't026-%'`);
  await db.execute(sql`DELETE FROM organizations WHERE name LIKE 't026-%'`);
}
