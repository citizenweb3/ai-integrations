"use client";

import { Badge } from "@/components/ui";
import type { AssistTurn, ScopeDraft } from "./scope-chat";

// Final preview card. Renders the scope the assistant produced, surfaces
// which optional fields were inferred (so the operator double-checks them
// before committing), and exposes Create campaign + Back to chat.
//
// Apply path: a hidden form posting to /api/commands with
// commandType=start_campaign. This reuses the sync validation and redirect
// behaviour added in T-026AC / T-026AL — on success the operator lands on
// /campaigns/<id> with discovery already kicked off; on validation failure
// the dashboard redirects to /campaigns/new?error=... where the chat tab
// re-greets while the error banner stays at the top of the card.
//
// Editing path: there is no inline editor. Operators tweak by clicking
// "Back to chat" and telling the assistant what to change. This keeps the
// component focused; the assistant already has the conversation context
// and can produce a revised scope without a parallel editing UX.

type ScopePreviewProps = {
  turn: Extract<AssistTurn, { type: "ready" }>;
  onBackToChat: () => void;
};

export default function ScopePreview({ turn, onBackToChat }: ScopePreviewProps) {
  const { scope, inferred, draftBrief } = turn;
  const inferredFields = new Map(inferred.map((flag) => [flag.field, flag.reason]));
  const hasBrief = Boolean(
    draftBrief &&
      (draftBrief.angle ||
        draftBrief.tone ||
        draftBrief.talkingPoints.length > 0 ||
        draftBrief.ourFacts.length > 0),
  );

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] opacity-70">
            Campaign scope ready
          </div>
          <p className="text-xs font-light opacity-60 mt-1 max-w-2xl leading-snug">
            Review the values below — fields with the AI-suggested pill were
            inferred from the conversation. If anything is off, click "Back to
            chat" and tell the assistant what to change.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PreviewField label="Campaign name" value={scope.name} />
        <PreviewField label="Desired CTA" value={scope.desiredCta} />
        <PreviewField
          label="Objective"
          value={scope.objective}
          className="md:col-span-2"
        />
        <PreviewField
          label="Offer summary"
          value={scope.offerSummary}
          className="md:col-span-2"
        />
        <PreviewField
          label="Target segments"
          value={scope.targetSegments.join(", ") || "—"}
          className="md:col-span-2"
        />

        {renderInferredField(
          "Discovery source hints",
          scope.discoverySourceHints,
          inferredFields.get("discoverySourceHints"),
        )}
        {renderInferredField(
          "Discovery exclusions",
          scope.discoveryExclusions,
          inferredFields.get("discoveryExclusions"),
        )}
        {renderInferredField(
          "Allowed regions",
          scope.allowedRegions,
          inferredFields.get("allowedRegions"),
        )}
        {renderInferredField(
          "Forbidden claims",
          scope.forbiddenClaims,
          inferredFields.get("forbiddenClaims"),
        )}
        {scope.operatorNotes ? (
          <PreviewField
            label="Operator notes"
            value={scope.operatorNotes}
            {...buildAiProps(inferredFields.get("operatorNotes"))}
            className="md:col-span-2"
          />
        ) : null}
      </div>

      {hasBrief && draftBrief ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="text-xs uppercase tracking-[0.2em] opacity-70 mb-3">
            Email drafting brief
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {draftBrief.angle ? (
              <PreviewField label="Angle" value={draftBrief.angle} className="md:col-span-2" />
            ) : null}
            {draftBrief.tone ? <PreviewField label="Tone" value={draftBrief.tone} /> : null}
            {draftBrief.talkingPoints.length > 0 ? (
              <PreviewField
                label="Key points"
                value={draftBrief.talkingPoints.map((p) => `• ${p}`).join("\n")}
                className="md:col-span-2"
              />
            ) : null}
            {draftBrief.ourFacts.length > 0 ? (
              <PreviewField
                label="About us"
                value={draftBrief.ourFacts.map((f) => `• ${f}`).join("\n")}
                className="md:col-span-2"
              />
            ) : null}
          </div>
          <p className="text-[11px] font-light opacity-50 leading-snug mt-3">
            Every cold draft this campaign produces will follow this brief.
          </p>
        </div>
      ) : null}

      <form action="/api/commands" method="post" className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="commandType" value="start_campaign" />
        <input type="hidden" name="name" value={scope.name} />
        <input type="hidden" name="objective" value={scope.objective} />
        <input type="hidden" name="offerSummary" value={scope.offerSummary} />
        <input type="hidden" name="desiredCta" value={scope.desiredCta} />
        <input
          type="hidden"
          name="targetSegments"
          value={scope.targetSegments.join("\n")}
        />
        <input
          type="hidden"
          name="forbiddenClaims"
          value={scope.forbiddenClaims.join("\n")}
        />
        <input type="hidden" name="operatorNotes" value={scope.operatorNotes} />
        <input
          type="hidden"
          name="discoverySourceHints"
          value={scope.discoverySourceHints.join("\n")}
        />
        <input
          type="hidden"
          name="discoveryExclusions"
          value={scope.discoveryExclusions.join("\n")}
        />
        <input
          type="hidden"
          name="allowedRegions"
          value={scope.allowedRegions.join("\n")}
        />
        <input
          type="hidden"
          name="maxOrganizationsToDiscover"
          value={String(scope.maxOrganizationsToDiscover)}
        />
        <input
          type="hidden"
          name="cooldownBetweenDiscoverySeconds"
          value={String(scope.cooldownBetweenDiscoverySeconds)}
        />
        {hasBrief && draftBrief ? (
          <input type="hidden" name="draftBrief" value={JSON.stringify(draftBrief)} />
        ) : null}

        <button
          type="submit"
          className="rounded-lg font-bold tracking-wide px-4 py-2.5 text-sm bg-[var(--accent)] text-black hover:opacity-90 transition-colors"
        >
          Create campaign
        </button>
        <button
          type="button"
          onClick={onBackToChat}
          className="rounded-lg font-bold tracking-wide px-4 py-2.5 text-sm bg-transparent border border-white/15 text-white hover:bg-white/5 transition-colors"
        >
          Back to chat
        </button>
        <span className="text-[11px] opacity-50 ml-auto">
          Submitting runs server-side validation; on success you land on the
          campaign page with discovery already running.
        </span>
      </form>
    </div>
  );
}

function renderInferredField(
  label: string,
  values: string[],
  reason: string | undefined,
) {
  if (!values || values.length === 0) {
    // Skip empty inferred lists — operators don't need a row that says "none";
    // if they want to add anything, they can do it via the chat or the form.
    return null;
  }
  return (
    <PreviewField
      label={label}
      value={values.join(", ")}
      {...buildAiProps(reason)}
    />
  );
}

// Build the `aiSuggested`/`reason` prop subset only when a reason exists.
// `exactOptionalPropertyTypes` rejects passing `reason: undefined`, so we
// spread an empty object instead when there is no inference to flag.
function buildAiProps(reason: string | undefined): {
  aiSuggested?: boolean;
  reason?: string;
} {
  return reason === undefined ? {} : { aiSuggested: true, reason };
}

function PreviewField({
  label,
  value,
  aiSuggested = false,
  reason,
  className,
}: {
  label: string;
  value: string;
  aiSuggested?: boolean;
  reason?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.15em] uppercase opacity-70">
        <span>{label}</span>
        {aiSuggested ? <Badge tone="accent">AI-suggested</Badge> : null}
      </div>
      <div className="text-sm font-light whitespace-pre-wrap break-words">
        {value}
      </div>
      {aiSuggested && reason ? (
        <div className="text-[11px] font-light opacity-50 leading-snug">
          Why: {reason}
        </div>
      ) : null}
    </div>
  );
}

// Re-export the type so scope-chat consumers can import from one place.
export type { ScopeDraft } from "./scope-chat";
