import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Button, Field, PageBody, inputClass, textareaClass } from "@/components/ui";
import { DismissableBanner } from "@/components/dismissable-banner";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const errorRaw = query["error"];
  const errorMessage =
    typeof errorRaw === "string" ? errorRaw : Array.isArray(errorRaw) ? errorRaw[0] : null;
  return (
    <>
      <ConsoleHero currentNav="campaigns"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            /{" "}
            <Link href="/campaigns" className="text-[hsl(var(--primary))]">
              Campaigns
            </Link>{" "}
            / New
          </>
        }
        title="New campaign"
        subtitle="Fill the campaign brief. The server validates the scope synchronously — on Save you land on the campaign page and discovery starts running automatically."
      />

      <PageBody>
        {errorMessage ? (
          <DismissableBanner
            tone="error"
            queryKey="error"
            eyebrow="Submission rejected"
            message={errorMessage}
            hint="Fix the highlighted fields and submit again. Nothing was saved to the database."
          />
        ) : null}

        <Card>
          <BlockTitle title="Campaign scope" className="mb-6 text-left" />
          <form className="grid grid-cols-1 md:grid-cols-2 gap-5" action="/api/commands" method="post">
            <input type="hidden" name="commandType" value="start_campaign" />

            <Field
              label="Campaign name"
              required
              hint="Short internal name. Operators see this in lists and inbox items."
              className="md:col-span-2"
            >
              <input
                name="name"
                placeholder="AI integration services outreach"
                required
                className={inputClass}
              />
            </Field>

            <Field
              label="Objective"
              required
              hint="What success looks like for this campaign — drives the discovery and drafting agents."
              className="md:col-span-2"
            >
              <textarea
                name="objective"
                placeholder="Book discovery calls with operations leaders evaluating AI workflow automation."
                required
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Offer summary"
              required
              hint="One-paragraph pitch of the product or service being offered. Surfaced to the research agent."
            >
              <textarea
                name="offerSummary"
                placeholder="Continuous AI workflow integration for ops-heavy teams."
                required
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Desired CTA"
              required
              hint="The single ask the cold email must drive toward (call, demo, intro)."
            >
              <textarea
                name="desiredCta"
                placeholder="Book a 20-minute discovery call this or next week."
                required
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Target segments"
              required
              hint="Industries / company types the discovery agent should look for. One per line."
            >
              <textarea
                name="targetSegments"
                placeholder={"B2B SaaS\nFintech\nDevTools"}
                required
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Forbidden claims"
              hint="Things the draft agent must never say (compliance, legal, sales policy). One per line."
            >
              <textarea
                name="forbiddenClaims"
                placeholder={"guaranteed ROI\n10x faster"}
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Operator notes"
              hint="Free-form notes for yourself or other operators. Not seen by agents."
              className="md:col-span-2"
            >
              <textarea
                name="operatorNotes"
                placeholder="Prioritize companies actively shipping LLM features."
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Discovery source hints"
              hint="Sites / sources the discovery agent should prefer. One per line."
            >
              <textarea
                name="discoverySourceHints"
                placeholder={"techcrunch.com\nbuiltin.com\nyc batch lists"}
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Discovery exclusions"
              hint="Domains, companies, or patterns to skip. One per line."
            >
              <textarea
                name="discoveryExclusions"
                placeholder={"competitor.com\n*.gov"}
                rows={3}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Allowed regions"
              hint="Countries / regions to keep. Leave empty for global. One per line."
              className="md:col-span-2"
            >
              <textarea
                name="allowedRegions"
                placeholder={"US\nEU\nUK"}
                rows={2}
                className={textareaClass}
              />
            </Field>

            <Field
              label="Sender identity (UUID)"
              hint="Reference to a configured sender profile (FROM email + signature). Leave blank for default."
            >
              <input
                name="senderIdentityId"
                placeholder="00000000-0000-0000-0000-000000000000"
                className={inputClass}
              />
            </Field>

            <Field
              label="Policy profile (UUID)"
              hint="Compliance / send-rate profile applied to this campaign. Leave blank for default."
            >
              <input
                name="policyProfileId"
                placeholder="00000000-0000-0000-0000-000000000000"
                className={inputClass}
              />
            </Field>

            <Field
              label="Max organizations to discover"
              hint="Cap on how many candidate orgs the discovery agent surfaces across the campaign's lifetime."
            >
              <input
                name="maxOrganizationsToDiscover"
                type="number"
                min={1}
                max={500}
                defaultValue={25}
                className={inputClass}
              />
            </Field>

            <Field
              label="Max concurrent enrichments"
              hint="Upper bound on parallel research-snapshot jobs for this campaign."
            >
              <input
                name="maxConcurrentEnrichments"
                type="number"
                min={1}
                max={100}
                defaultValue={3}
                className={inputClass}
              />
            </Field>

            <Field
              label="Max concurrent drafts"
              hint="How many cold-draft jobs may run in parallel."
            >
              <input
                name="maxConcurrentDrafts"
                type="number"
                min={1}
                max={100}
                defaultValue={5}
                className={inputClass}
              />
            </Field>

            <Field
              label="Max open draft reviews"
              hint="Pause draft generation once this many drafts are awaiting operator review."
            >
              <input
                name="maxOpenDraftReviews"
                type="number"
                min={1}
                max={500}
                defaultValue={25}
                className={inputClass}
              />
            </Field>

            <Field
              label="Cooldown between discovery runs (seconds)"
              hint="Minimum wait between consecutive discovery passes. 3600 = one hour."
              className="md:col-span-2"
            >
              <input
                name="cooldownBetweenDiscoverySeconds"
                type="number"
                min={0}
                max={604800}
                defaultValue={3600}
                className={inputClass}
              />
            </Field>

            {/* T-026AI: the "Allow generic-inbox fallback" checkbox is gone.
               The contact-discovery agent now always searches for one
               company-wide inbox (info@ / sales@ / partners@ / …) verbatim
               from a public page and surfaces it alongside specific
               people, so there is nothing to opt into. */}

            <Button type="submit" className="md:col-span-2">
              Create campaign
            </Button>
          </form>
        </Card>
      </PageBody>
    </>
  );
}
