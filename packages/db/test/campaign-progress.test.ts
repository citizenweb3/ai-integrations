import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { inArray, sql } from "drizzle-orm";
import {
  campaigns,
  closeDb,
  contacts,
  discoveryCandidates,
  drafts,
  getCampaignDiscoveryView,
  getCampaignProgress,
  getDb,
  inboundMessages,
  listCampaignsForDashboard,
  organizations,
  outboundMessages,
  outreachRecords,
  researchContactCandidates,
  threads
} from "../src";

after(async () => {
  await closeDb();
});

test("campaign progress rolls up contacts, drafts, sends, replies, and activity", async (t) => {
  const db = getDb();
  await clearT022Artifacts();
  t.after(clearT022Artifacts);

  const fixture = await insertCampaignProgressFixture();

  const progress = await getCampaignProgress(fixture.campaignId);
  assert.equal(progress.contactsAccepted, 2);
  assert.equal(progress.draftsGenerated, 3);
  assert.equal(progress.draftsApproved, 2);
  assert.equal(progress.sent, 2);
  assert.equal(progress.replied, 3);
  assert.deepEqual(progress.replyClassCounts, {
    positive_interest: 1,
    question: 1,
    unclassified: 1
  });
  assert.equal(progress.lastActivityAt?.toISOString(), fixture.latestActivityAt.toISOString());

  const campaignsList = await listCampaignsForDashboard(200);
  const listItem = campaignsList.find((campaign) => campaign.id === fixture.campaignId);
  assert.ok(listItem);
  assert.equal(listItem.progress.contactsAccepted, 2);
  assert.equal(listItem.progress.draftsGenerated, 3);
  assert.equal(listItem.progress.draftsApproved, 2);
  assert.equal(listItem.progress.sent, 2);
  assert.equal(listItem.progress.replied, 3);
  assert.deepEqual(listItem.progress.replyClassCounts, progress.replyClassCounts);
  assert.equal(listItem.progress.lastActivityAt?.toISOString(), fixture.latestActivityAt.toISOString());

  const view = await getCampaignDiscoveryView(fixture.campaignId);
  assert.ok(view);
  assert.equal(view.progress.contactsAccepted, 2);
  assert.equal(view.progress.draftsGenerated, 3);
  assert.equal(view.progress.draftsApproved, 2);
  assert.equal(view.progress.sent, 2);
  assert.equal(view.progress.replied, 3);
  assert.deepEqual(view.progress.replyClassCounts, progress.replyClassCounts);
  assert.equal(view.progress.lastActivityAt?.toISOString(), fixture.latestActivityAt.toISOString());

  const otherProgress = await getCampaignProgress(fixture.otherCampaignId);
  assert.equal(otherProgress.contactsAccepted, 1);
  assert.equal(otherProgress.draftsGenerated, 1);
  assert.equal(otherProgress.sent, 1);
  assert.equal(otherProgress.replied, 1);
});

async function insertCampaignProgressFixture(): Promise<{
  campaignId: string;
  otherCampaignId: string;
  latestActivityAt: Date;
}> {
  const db = getDb();
  const suffix = randomUUID();
  const baseAt = new Date("2026-01-10T10:00:00.000Z");
  const latestActivityAt = new Date("2026-01-10T10:06:00.000Z");

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t022-org-${suffix}`,
      domain: `t022-${suffix}.example`,
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [convertedOrganization] = await db
    .insert(organizations)
    .values({
      name: `t022-converted-org-${suffix}`,
      domain: `t022-converted-${suffix}.example`,
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: organizations.id });
  assert.ok(convertedOrganization);

  const [otherOrganization] = await db
    .insert(organizations)
    .values({
      name: `t022-other-org-${suffix}`,
      domain: `t022-other-${suffix}.example`,
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: organizations.id });
  assert.ok(otherOrganization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t022-campaign-${suffix}`,
      status: "active",
      objective: "Measure campaign progress rollups",
      targetSegments: ["T022"],
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [otherCampaign] = await db
    .insert(campaigns)
    .values({
      name: `t022-other-campaign-${suffix}`,
      status: "active",
      objective: "Verify campaign progress isolation",
      targetSegments: ["T022"],
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: campaigns.id });
  assert.ok(otherCampaign);

  const [contact] = await db
    .insert(contacts)
    .values({
      organizationId: organization.id,
      email: `t022-${suffix}@example.com`,
      fullName: "T022 Buyer",
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: contacts.id });
  assert.ok(contact);

  const [convertedContact] = await db
    .insert(contacts)
    .values({
      organizationId: convertedOrganization.id,
      email: `t022-converted-${suffix}@example.com`,
      fullName: "T022 Converted Buyer",
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: contacts.id });
  assert.ok(convertedContact);

  const [otherContact] = await db
    .insert(contacts)
    .values({
      organizationId: otherOrganization.id,
      email: `t022-other-${suffix}@example.com`,
      fullName: "T022 Other Buyer",
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: contacts.id });
  assert.ok(otherContact);

  const [thread] = await db
    .insert(threads)
    .values({
      campaignId: campaign.id,
      organizationId: organization.id,
      status: "open",
      providerThreadKey: `t022-thread-${suffix}`,
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: threads.id });
  assert.ok(thread);

  const [otherThread] = await db
    .insert(threads)
    .values({
      campaignId: otherCampaign.id,
      organizationId: otherOrganization.id,
      status: "open",
      providerThreadKey: `t022-other-thread-${suffix}`,
      createdAt: baseAt,
      updatedAt: baseAt
    })
    .returning({ id: threads.id });
  assert.ok(otherThread);

  await db.insert(outreachRecords).values({
    campaignId: campaign.id,
    organizationId: organization.id,
    contactId: contact.id,
    status: "planned",
    createdAt: baseAt,
    updatedAt: new Date("2026-01-10T10:01:00.000Z")
  });

  await db.insert(outreachRecords).values({
    campaignId: otherCampaign.id,
    organizationId: otherOrganization.id,
    contactId: otherContact.id,
    status: "planned",
    createdAt: baseAt,
    updatedAt: baseAt
  });

  await db.insert(discoveryCandidates).values({
    campaignId: campaign.id,
    proposedName: `t022-converted-org-${suffix}`,
    domain: `t022-converted-${suffix}.example`,
    sourceRefs: [{ url: "https://example.com/t022" }],
    dedupeResult: "strong",
    matchedOrganizationId: convertedOrganization.id,
    status: "accepted",
    createdAt: baseAt,
    updatedAt: new Date("2026-01-10T10:02:00.000Z")
  });

  await db.insert(researchContactCandidates).values({
    organizationId: convertedOrganization.id,
    email: `t022-converted-${suffix}@example.com`,
    fullName: "T022 Converted Buyer",
    confidence: 95,
    status: "converted",
    convertedContactId: convertedContact.id,
    createdAt: baseAt,
    updatedAt: new Date("2026-01-10T10:03:00.000Z")
  });

  await db.insert(drafts).values([
    {
      campaignId: campaign.id,
      threadId: thread.id,
      contactId: contact.id,
      subject: `T022 draft A ${suffix}`,
      body: "Generated draft A",
      status: "draft",
      createdAt: baseAt,
      updatedAt: new Date("2026-01-10T10:02:30.000Z")
    },
    {
      campaignId: campaign.id,
      threadId: thread.id,
      contactId: contact.id,
      subject: `T022 draft B ${suffix}`,
      body: "Approved draft B",
      status: "approved_pending_send",
      createdAt: baseAt,
      updatedAt: new Date("2026-01-10T10:04:00.000Z")
    },
    {
      campaignId: campaign.id,
      threadId: thread.id,
      contactId: convertedContact.id,
      subject: `T022 draft C ${suffix}`,
      body: "Approved draft C",
      status: "approved",
      createdAt: baseAt,
      updatedAt: new Date("2026-01-10T10:04:30.000Z")
    },
    {
      campaignId: otherCampaign.id,
      threadId: otherThread.id,
      contactId: otherContact.id,
      subject: `T022 other draft ${suffix}`,
      body: "Other campaign draft",
      status: "approved",
      createdAt: baseAt,
      updatedAt: baseAt
    }
  ]);

  await db.insert(outboundMessages).values([
    {
      threadId: thread.id,
      campaignId: campaign.id,
      contactId: contact.id,
      recipientEmail: `t022-${suffix}@example.com`,
      provider: "resend",
      status: "sent",
      idempotencyKey: `t022-outbound-a:${suffix}`,
      payloadSnapshotJson: {},
      createdAt: baseAt,
      updatedAt: new Date("2026-01-10T10:05:00.000Z")
    },
    {
      threadId: thread.id,
      campaignId: campaign.id,
      contactId: convertedContact.id,
      recipientEmail: `t022-converted-${suffix}@example.com`,
      provider: "resend",
      status: "delivery_delivered",
      idempotencyKey: `t022-outbound-b:${suffix}`,
      payloadSnapshotJson: {},
      createdAt: baseAt,
      updatedAt: new Date("2026-01-10T10:05:30.000Z")
    },
    {
      threadId: thread.id,
      campaignId: campaign.id,
      contactId: contact.id,
      recipientEmail: `t022-${suffix}@example.com`,
      provider: "resend",
      status: "send_requested",
      idempotencyKey: `t022-outbound-requested:${suffix}`,
      payloadSnapshotJson: {},
      createdAt: baseAt,
      updatedAt: baseAt
    },
    {
      threadId: otherThread.id,
      campaignId: otherCampaign.id,
      contactId: otherContact.id,
      recipientEmail: `t022-other-${suffix}@example.com`,
      provider: "resend",
      status: "sent",
      idempotencyKey: `t022-other-outbound:${suffix}`,
      payloadSnapshotJson: {},
      createdAt: baseAt,
      updatedAt: baseAt
    }
  ]);

  await db.insert(inboundMessages).values([
    {
      threadId: thread.id,
      fromEmail: `t022-${suffix}@example.com`,
      subject: "Re: T022",
      rawText: "Interested.",
      replyClass: "positive_interest",
      createdAt: new Date("2026-01-10T10:05:45.000Z")
    },
    {
      threadId: thread.id,
      fromEmail: `t022-converted-${suffix}@example.com`,
      subject: "Re: T022",
      rawText: "What is the price?",
      replyClass: "question",
      createdAt: latestActivityAt
    },
    {
      threadId: thread.id,
      fromEmail: `t022-${suffix}@example.com`,
      subject: "Re: T022",
      rawText: "Unclassified reply.",
      createdAt: new Date("2026-01-10T10:05:50.000Z")
    },
    {
      threadId: otherThread.id,
      fromEmail: `t022-other-${suffix}@example.com`,
      subject: "Re: T022 other",
      rawText: "Other reply.",
      replyClass: "not_now",
      createdAt: baseAt
    }
  ]);

  return {
    campaignId: campaign.id,
    otherCampaignId: otherCampaign.id,
    latestActivityAt
  };
}

async function clearT022Artifacts() {
  const db = getDb();
  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.name} like 't022-%'`);
  const campaignIds = campaignRows.map((row) => row.id);

  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.name} like 't022-%'`);
  const orgIds = orgRows.map((row) => row.id);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.email} like 't022-%'`);
  const contactIds = contactRows.map((row) => row.id);

  const threadRows = await db
    .select({ id: threads.id })
    .from(threads)
    .where(sql`${threads.providerThreadKey} like 't022-%'`);
  const threadIds = threadRows.map((row) => row.id);

  if (threadIds.length > 0) {
    await db.delete(inboundMessages).where(inArray(inboundMessages.threadId, threadIds));
  }
  await db.delete(outboundMessages).where(sql`${outboundMessages.idempotencyKey} like 't022-%'`);
  await db.delete(drafts).where(sql`${drafts.subject} like 'T022%'`);
  if (campaignIds.length > 0) {
    await db.delete(outboundMessages).where(inArray(outboundMessages.campaignId, campaignIds));
    await db.delete(drafts).where(inArray(drafts.campaignId, campaignIds));
    await db.delete(outreachRecords).where(inArray(outreachRecords.campaignId, campaignIds));
  }
  if (contactIds.length > 0) {
    await db
      .delete(researchContactCandidates)
      .where(inArray(researchContactCandidates.convertedContactId, contactIds));
  }
  await db
    .delete(researchContactCandidates)
    .where(sql`${researchContactCandidates.email} like 't022-%'`);
  if (campaignIds.length > 0) {
    await db.delete(discoveryCandidates).where(inArray(discoveryCandidates.campaignId, campaignIds));
  }
  if (threadIds.length > 0) await db.delete(threads).where(inArray(threads.id, threadIds));
  if (contactIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, contactIds));
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds));
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
}
