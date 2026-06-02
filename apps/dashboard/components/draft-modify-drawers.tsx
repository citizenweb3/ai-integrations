import { draftFeedbackTags } from "@bizdev/shared";
import { SideDrawer } from "@/components/side-drawer";
import { Button, inputClass, textareaClass } from "@/components/ui";

// T-026BN: the draft "Modify" write-actions, extracted so the same set of
// side-panel forms can sit on the full draft page AND inline on the cold/warm
// draft preview panels (org page + work-item page). Only the actions that need
// nothing beyond the draft's id/version/subject/body live here — "Investigate
// flagged claims" stays on the full draft page because it needs the draft's
// claim list + org/campaign context.
//
// Each form posts to /api/commands and the page revalidates on redirect, so an
// edit made from a preview panel reloads that same panel with the new version.
export function DraftModifyDrawers({
  draftId,
  version,
  subject,
  body
}: {
  draftId: string;
  version: number;
  subject: string;
  body: string;
}) {
  return (
    <>
      <SideDrawer
        triggerLabel="Edit body manually"
        description="Direct edit. Saves as a new version; previous one stays in history."
        title={`Edit draft v${version} → v${version + 1}`}
      >
        <form action="/api/commands" method="post" className="space-y-3">
          <input type="hidden" name="commandType" value="request_manual_edit_save" />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="expectedVersion" value={String(version)} />
          <input className={inputClass} name="subject" defaultValue={subject} required />
          <textarea
            className={textareaClass}
            name="body"
            defaultValue={body}
            required
            rows={14}
          />
          <textarea className={textareaClass} name="notes" placeholder="Edit notes (optional)" />
          <Button type="submit">Save as v{version + 1}</Button>
        </form>
      </SideDrawer>

      <SideDrawer
        triggerLabel="Ask the AI to revise"
        description="Enqueues job.revise_draft. Agent reads current version + your feedback + latest research, writes a new version with revalidated claims."
        title="Request AI revise"
      >
        <form action="/api/commands" method="post" className="space-y-3">
          <input type="hidden" name="commandType" value="request_ai_revise" />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="expectedVersion" value={String(version)} />
          <textarea
            className={textareaClass}
            name="operatorFeedback"
            placeholder="What to change: tone, angle, ask, claims to drop, new angle to push..."
            required
            rows={6}
          />
          <Button type="submit">Request AI revise</Button>
        </form>
      </SideDrawer>

      <SideDrawer
        triggerLabel="Record feedback on this draft"
        description="Standalone explicit signal — feeds the quality / corpus scoring and lands in the feedback log."
        title="Record feedback"
      >
        <form action="/api/commands" method="post" className="space-y-3">
          <input type="hidden" name="commandType" value="record_draft_feedback" />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="draftVersion" value={String(version)} />
          <fieldset className="border border-white/15 rounded-lg p-3">
            <legend className="text-xs opacity-60 px-2">Tags</legend>
            <div className="flex flex-wrap gap-3">
              {draftFeedbackTags.map((tag) => (
                <label key={tag} className="inline-flex gap-2 items-center">
                  <input type="checkbox" name="tags" value={tag} />
                  <code className="font-mono text-xs">{tag}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <textarea
            className={textareaClass}
            name="note"
            placeholder="Free-form note (optional if at least one tag is checked)"
            rows={4}
          />
          <Button type="submit">Record feedback</Button>
        </form>
      </SideDrawer>
    </>
  );
}
