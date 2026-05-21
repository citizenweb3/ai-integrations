import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Button, PageBody, inputClass, textareaClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function NewCampaignPage() {
  return (
    <>
      <ConsoleHero
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
        subtitle="Create a scoped campaign, then the expansion job will validate readiness before discovery starts."
      />

      <PageBody>
        <Card>
          <BlockTitle title="Campaign scope" className="mb-4 text-left" />
          <form className="grid grid-cols-1 md:grid-cols-2 gap-3" action="/api/commands" method="post">
            <input type="hidden" name="commandType" value="start_campaign" />
            <input
              name="name"
              placeholder="AI integration services outreach"
              required
              className={`${inputClass} md:col-span-2`}
            />
            <textarea
              name="objective"
              placeholder="Book discovery calls with operations leaders evaluating AI workflow automation."
              required
              rows={3}
              className={`${textareaClass} md:col-span-2`}
            />
            <textarea
              name="offerSummary"
              placeholder="Offer summary"
              required
              rows={3}
              className={textareaClass}
            />
            <textarea
              name="desiredCta"
              placeholder="Desired CTA"
              required
              rows={3}
              className={textareaClass}
            />
            <textarea
              name="targetSegments"
              placeholder="Target segments, one per line"
              required
              rows={3}
              className={textareaClass}
            />
            <textarea
              name="forbiddenClaims"
              placeholder="Forbidden claims, one per line"
              rows={3}
              className={textareaClass}
            />
            <textarea
              name="operatorNotes"
              placeholder="Operator notes"
              rows={3}
              className={textareaClass}
            />
            <textarea
              name="discoverySourceHints"
              placeholder="Discovery source hints, one per line"
              rows={3}
              className={textareaClass}
            />
            <textarea
              name="discoveryExclusions"
              placeholder="Discovery exclusions, one per line"
              rows={3}
              className={textareaClass}
            />
            <textarea
              name="allowedRegions"
              placeholder="Allowed regions, one per line"
              rows={3}
              className={textareaClass}
            />
            <input
              name="senderIdentityId"
              placeholder="Sender identity UUID"
              className={inputClass}
            />
            <input
              name="policyProfileId"
              placeholder="Policy profile UUID"
              className={inputClass}
            />
            <input
              name="maxOrganizationsToDiscover"
              type="number"
              aria-label="Max organizations to discover"
              min={1}
              max={500}
              defaultValue={25}
              className={inputClass}
            />
            <input
              name="maxConcurrentEnrichments"
              type="number"
              aria-label="Max concurrent enrichments"
              min={1}
              max={100}
              defaultValue={3}
              className={inputClass}
            />
            <input
              name="maxConcurrentDrafts"
              type="number"
              aria-label="Max concurrent drafts"
              min={1}
              max={100}
              defaultValue={5}
              className={inputClass}
            />
            <input
              name="maxOpenDraftReviews"
              type="number"
              aria-label="Max open draft reviews"
              min={1}
              max={500}
              defaultValue={25}
              className={inputClass}
            />
            <input
              name="cooldownBetweenDiscoverySeconds"
              type="number"
              aria-label="Cooldown between discovery seconds"
              min={0}
              max={604800}
              defaultValue={3600}
              className={`${inputClass} md:col-span-2`}
            />
            <Button type="submit" className="md:col-span-2">
              Create campaign
            </Button>
          </form>
        </Card>
      </PageBody>
    </>
  );
}
