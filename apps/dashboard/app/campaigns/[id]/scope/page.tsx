import { getCampaignDiscoveryView, type CampaignDiscoveryView } from "@bizdev/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { DismissableBanner } from "@/components/dismissable-banner";
import {
  Badge,
  Button,
  PageBody,
  inputClass,
  textareaClass
} from "@/components/ui";

// T-026AK/A: scope-editing form moved off the campaign detail page into a
// dedicated subpage. The detail page now renders a short "Fix scope" CTA
// when the validator marked the scope incomplete; the operator clicks
// through to here to actually fix it. Keeps the detail page focused on
// the campaign at runtime instead of doubling as a 16-input edit form.

export const dynamic = "force-dynamic";

export default async function CampaignScopePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const errorRaw = query["error"];
  const errorMessage =
    typeof errorRaw === "string" ? errorRaw : Array.isArray(errorRaw) ? errorRaw[0] : null;
  const noticeRaw = query["notice"];
  const noticeMessage =
    typeof noticeRaw === "string" ? noticeRaw : Array.isArray(noticeRaw) ? noticeRaw[0] : null;

  const view = await getCampaignDiscoveryView(id);
  if (!view) {
    notFound();
  }

  const isDraftingScope = view.campaign.status === "drafting_scope";
  const scopeState = view.scopeValidation.state;
  const missingFields = view.scopeValidation.missingFields;

  return (
    <>
      <ConsoleHero
        currentNav="campaigns"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            /{" "}
            <Link href="/campaigns" className="text-[hsl(var(--primary))]">
              Campaigns
            </Link>{" "}
            /{" "}
            <Link
              href={`/campaigns/${view.campaign.id}`}
              className="text-[hsl(var(--primary))]"
            >
              {view.campaign.name}
            </Link>{" "}
            / Scope
          </>
        }
        title={`Scope · ${view.campaign.name}`}
        subtitle={
          isDraftingScope
            ? "Fix the campaign brief so the validator passes. Discovery starts automatically on a clean save."
            : "Campaign is live. The scope is read-only because edits are only allowed while in drafting_scope."
        }
      />

      <PageBody>
        {errorMessage ? (
          <DismissableBanner
            tone="error"
            queryKey="error"
            eyebrow="Last action failed"
            message={errorMessage}
            hint="Code + message returned by the command handler. Fix the form and retry."
          />
        ) : null}

        {noticeMessage ? (
          <DismissableBanner
            tone="notice"
            queryKey="notice"
            eyebrow="Action confirmed"
            message={noticeMessage}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={`/campaigns/${view.campaign.id}`}
            className="opacity-70 hover:opacity-100 underline decoration-dotted"
          >
            ← Back to campaign
          </Link>
          <span className="opacity-40">·</span>
          <span className="opacity-70">
            Status: <Badge tone={isDraftingScope ? "warning" : "default"}>{view.campaign.status}</Badge>
          </span>
          {scopeState === "pending" ? (
            <>
              <span className="opacity-40">·</span>
              <span className="opacity-70">Validation: pending</span>
            </>
          ) : null}
        </div>

        {scopeState === "incomplete" && missingFields.length > 0 ? (
          <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/5 p-5">
            <div className="text-xs font-semibold tracking-[0.2em] uppercase text-yellow-400 mb-2">
              Validator caught missing fields
            </div>
            <p className="text-sm font-light opacity-90 mb-2">
              Fix these fields and Save:
            </p>
            <ul className="list-disc pl-5 text-sm opacity-90">
              {missingFields.map((f) => (
                <li key={f}>
                  <code className="font-mono text-xs">{f}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {isDraftingScope ? (
          <CampaignScopeForm campaign={view.campaign} />
        ) : (
          <Card>
            <BlockTitle title="Scope (read-only)" className="mb-4 text-left" />
            <p className="text-sm font-light opacity-80">
              This campaign is currently in <code>{view.campaign.status}</code>. The
              <code className="mx-1">update_campaign_scope</code>
              command only accepts changes while the campaign is in
              <code className="mx-1">drafting_scope</code>. To raise caps or change segments on a
              live campaign, ask an engineer for a schema-level update — this is by design and
              keeps the agent budget predictable per active campaign.
            </p>
          </Card>
        )}
      </PageBody>
    </>
  );
}

// T-026AK/A: lifted from `apps/dashboard/app/campaigns/[id]/page.tsx`.
// Unchanged behaviour; just lives next to the route that owns it now.
function CampaignScopeForm({
  campaign
}: {
  campaign: CampaignDiscoveryView["campaign"];
}) {
  return (
    <Card>
      <BlockTitle title="Complete scope" className="mb-2 text-left" />
      <p className="text-sm font-light opacity-80 mb-4">
        This campaign is in <code>drafting_scope</code>: the validator caught missing or invalid required
        fields when the campaign was first submitted. Fix the form below and Save — discovery will start
        automatically as soon as validation passes.
      </p>
      <form action="/api/commands" method="post" className="space-y-5">
        <input type="hidden" name="commandType" value="update_campaign_scope" />
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScopeLabel label="Name">
            <input className={inputClass} name="name" defaultValue={campaign.name} required />
          </ScopeLabel>
          <ScopeLabel label="Objective">
            <input className={inputClass} name="objective" defaultValue={campaign.objective} required />
          </ScopeLabel>
        </div>

        <ScopeLabel label="Offer summary">
          <textarea
            className={textareaClass}
            name="offerSummary"
            defaultValue={campaign.offerSummary ?? ""}
            required
          />
        </ScopeLabel>

        <ScopeLabel label="Desired CTA">
          <textarea
            className={textareaClass}
            name="desiredCta"
            defaultValue={campaign.desiredCta ?? ""}
            required
          />
        </ScopeLabel>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScopeLabel label="Target segments">
            <textarea
              className={textareaClass}
              name="targetSegments"
              defaultValue={formatMultilineValue(campaign.targetSegments)}
              required
            />
          </ScopeLabel>
          <ScopeLabel label="Forbidden claims">
            <textarea
              className={textareaClass}
              name="forbiddenClaims"
              defaultValue={formatMultilineValue(campaign.forbiddenClaims)}
            />
          </ScopeLabel>
        </div>

        <ScopeLabel label="Operator notes">
          <textarea
            className={textareaClass}
            name="operatorNotes"
            defaultValue={campaign.operatorNotes ?? ""}
          />
        </ScopeLabel>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ScopeLabel label="Source hints">
            <textarea
              className={textareaClass}
              name="discoverySourceHints"
              defaultValue={formatMultilineValue(campaign.discoverySourceHints)}
            />
          </ScopeLabel>
          <ScopeLabel label="Exclusions">
            <textarea
              className={textareaClass}
              name="discoveryExclusions"
              defaultValue={formatMultilineValue(campaign.discoveryExclusions)}
            />
          </ScopeLabel>
          <ScopeLabel label="Allowed regions">
            <textarea
              className={textareaClass}
              name="allowedRegions"
              defaultValue={formatMultilineValue(campaign.allowedRegions)}
            />
          </ScopeLabel>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScopeLabel label="Sender identity ID">
            <input className={inputClass} name="senderIdentityId" defaultValue={campaign.senderIdentityId ?? ""} />
          </ScopeLabel>
          <ScopeLabel label="Policy profile ID">
            <input className={inputClass} name="policyProfileId" defaultValue={campaign.policyProfileId ?? ""} />
          </ScopeLabel>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ScopeLabel label="Org cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxOrganizationsToDiscover"
              defaultValue={campaign.maxOrganizationsToDiscover}
            />
          </ScopeLabel>
          <ScopeLabel label="Enrich cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxConcurrentEnrichments"
              defaultValue={campaign.maxConcurrentEnrichments}
            />
          </ScopeLabel>
          <ScopeLabel label="Draft cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxConcurrentDrafts"
              defaultValue={campaign.maxConcurrentDrafts}
            />
          </ScopeLabel>
          <ScopeLabel label="Review cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxOpenDraftReviews"
              defaultValue={campaign.maxOpenDraftReviews}
            />
          </ScopeLabel>
        </div>

        <ScopeLabel label="Discovery cooldown seconds" className="max-w-xs">
          <input
            className={inputClass}
            type="number"
            min={0}
            name="cooldownBetweenDiscoverySeconds"
            defaultValue={campaign.cooldownBetweenDiscoverySeconds}
          />
        </ScopeLabel>

        <Button type="submit">Save scope</Button>
      </form>
    </Card>
  );
}

function ScopeLabel({
  label,
  className = "",
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="block text-xs uppercase tracking-[0.18em] opacity-70">{label}</span>
      {children}
    </label>
  );
}

function formatMultilineValue(values: string[]): string {
  return values.join("\n");
}
