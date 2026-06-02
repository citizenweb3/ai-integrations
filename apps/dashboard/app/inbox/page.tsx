import {
  DEFAULT_INBOX_OPERATOR_ID,
  getInboxView,
  inboxTabs,
  type InboxSavedView,
  type InboxTab,
  type InboxViewFilter,
  type InboxWorkItemRow
} from "@bizdev/db";
import { buildWorkItemActionIdempotencyKey } from "@bizdev/shared";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import { SideDrawer } from "@/components/side-drawer";
import { Badge, Button, Field, PageBody, PillLink, inputClass } from "@/components/ui";
import { TONE_CLASSES, workItemMeta, type WorkItemTone } from "@/lib/work-item-types";

export const dynamic = "force-dynamic";

const tabLabels: Record<InboxTab, string> = {
  replies: "Replies",
  unmatched: "Unmatched",
  approvals: "Approvals",
  attention: "Attention",
  all: "All open"
};

// Primary triage buckets (everything except the catch-all "all"). These render
// as the big clickable nav tiles up top; the order is the operator's scan order
// (replies first — that's the money signal).
const BUCKETS: {
  tab: Exclude<InboxTab, "all">;
  glyph: string;
  sublabel: string;
  tone: WorkItemTone;
}[] = [
  { tab: "replies", glyph: "🔥", sublabel: "Humans replied to us", tone: "accent" },
  { tab: "unmatched", glyph: "✉", sublabel: "Inbound needs matching", tone: "neutral" },
  { tab: "approvals", glyph: "✍", sublabel: "Drafts to greenlight", tone: "primary" },
  { tab: "attention", glyph: "🛡", sublabel: "Policy & blockers", tone: "danger" }
];

function priorityMeta(priority: number): { label: string; cls: string } {
  if (priority >= 90) return { label: "P0", cls: "border-red-500/40 bg-red-500/15 text-red-300" };
  if (priority >= 70) return { label: "P1", cls: "border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)]" };
  if (priority >= 40) return { label: "P2", cls: "border-white/20 bg-white/10 text-white/70" };
  return { label: "P3", cls: "border-white/10 bg-white/5 text-white/45" };
}

function parseTab(value: string | string[] | undefined): InboxTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (inboxTabs as readonly string[]).includes(candidate ?? "")
    ? (candidate as InboxTab)
    : "replies";
}

function parseString(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function inboxHref(input: { tab?: InboxTab; view?: string; cursor?: string | null }) {
  const params = new URLSearchParams();
  if (input.view) {
    params.set("view", input.view);
  } else {
    params.set("tab", input.tab ?? "replies");
  }
  if (input.cursor) {
    params.set("cursor", input.cursor);
  }
  return `/inbox?${params.toString()}`;
}

function filterSummary(filter: InboxViewFilter) {
  const parts = [];
  if (filter.types?.length) parts.push(`types: ${filter.types.join(", ")}`);
  if (filter.statuses?.length) parts.push(`statuses: ${filter.statuses.join(", ")}`);
  if (filter.campaignIds?.length) parts.push(`${filter.campaignIds.length} campaign${filter.campaignIds.length === 1 ? "" : "s"}`);
  if (filter.priorityMin !== undefined) parts.push(`P >= ${filter.priorityMin}`);
  if (filter.fromEmail) parts.push(`from: ${filter.fromEmail}`);
  return parts.length > 0 ? parts.join(" · ") : "All active inbox items";
}

function filterFieldValue(view: InboxSavedView, key: keyof InboxViewFilter) {
  const value = view.filterJson[key];
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

// Tile border/glow per tone — full literal strings so Tailwind keeps them.
const TILE_TONE: Record<WorkItemTone, { idle: string; hot: string; ring: string }> = {
  accent: { idle: "border-white/10", hot: "border-[var(--accent)]/40", ring: "ring-[var(--accent)]/60" },
  primary: { idle: "border-white/10", hot: "border-[hsl(var(--primary))]/40", ring: "ring-[hsl(var(--primary))]/60" },
  warning: { idle: "border-white/10", hot: "border-yellow-500/40", ring: "ring-yellow-500/60" },
  danger: { idle: "border-white/10", hot: "border-red-500/40", ring: "ring-red-500/60" },
  neutral: { idle: "border-white/10", hot: "border-white/25", ring: "ring-white/40" }
};

type Props = {
  searchParams: Promise<{
    tab?: string | string[];
    view?: string | string[];
    cursor?: string | string[];
    error?: string | string[];
  }>;
};

export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const savedViewId = parseString(params.view) ?? null;
  const cursor = parseString(params.cursor) ?? null;
  const error = parseString(params.error);
  const view = await getInboxView({
    tab,
    savedViewId,
    cursor,
    operatorId: DEFAULT_INBOX_OPERATOR_ID
  });
  const activeLabel = view.activeSavedView?.name ?? tabLabels[tab];
  const usingSavedView = Boolean(view.activeSavedView);

  return (
    <>
      <ConsoleHero
        currentNav="inbox"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Inbox
          </>
        }
        title="Operator Inbox"
        subtitle="Everything that needs a human decision — replies, unmatched inbound, drafts, and blockers — in one queue."
      />

      <PageBody>
        {/* Triage tiles double as the primary tab navigation. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {BUCKETS.map((bucket) => {
            const count = view.counts[bucket.tab];
            const active = !usingSavedView && tab === bucket.tab;
            const tones = TILE_TONE[bucket.tone];
            // Border picks up the tone only when there's something in the bucket.
            // The active ring stays calm (neutral) for an empty bucket so an
            // active-but-empty "Attention" tile doesn't read as alarming.
            const border = count > 0 ? tones.hot : tones.idle;
            const ringCls = active ? (count > 0 ? `ring-2 ${tones.ring}` : "ring-2 ring-white/30") : "";
            const numberColor = count > 0 ? TONE_CLASSES[bucket.tone].text : "text-white/30";
            return (
              <Link
                key={bucket.tab}
                href={inboxHref({ tab: bucket.tab })}
                className={`group block rounded-2xl border bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-all hover:no-underline hover:bg-white/[0.07] ${border} ${ringCls}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className={`text-4xl font-bold tabular-nums tracking-tight ${numberColor}`}>
                    {count}
                  </span>
                  <span className="text-2xl opacity-70 group-hover:opacity-100 transition-opacity">
                    {bucket.glyph}
                  </span>
                </div>
                <div className="mt-4">
                  <div className="text-base font-bold tracking-[0.02em]">{tabLabels[bucket.tab]}</div>
                  <div className="text-xs font-light opacity-55 mt-0.5">{bucket.sublabel}</div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Secondary row: all-open + saved-view pills + manage-views drawer. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={inboxHref({ tab: "all" })}
            className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-colors hover:no-underline ${
              !usingSavedView && tab === "all"
                ? "bg-[var(--accent)] text-black"
                : "bg-[#1A1A1B] border-b border-[#262626] text-white hover:bg-[#262626]"
            }`}
          >
            All open ({view.counts.all})
          </Link>
          {view.savedViews.map((saved) => {
            const active = view.activeSavedView?.id === saved.id;
            return (
              <Link
                key={saved.id}
                href={inboxHref({ view: saved.id })}
                className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-colors hover:no-underline ${
                  active
                    ? "bg-[hsl(var(--primary))] text-white"
                    : "bg-[#1A1A1B] border-b border-[#262626] text-white hover:bg-[#262626]"
                }`}
              >
                ★ {saved.name}
              </Link>
            );
          })}
          <div className="ml-auto">
            <SavedViewsDrawer savedViews={view.savedViews} />
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {/* The active queue. */}
        <section>
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 className="text-2xl font-bold tracking-[0.05em]">
              {activeLabel}{" "}
              <span className="text-base font-light opacity-50 tabular-nums">{view.totalCount}</span>
            </h2>
            {view.items.length > 0 ? (
              <span className="text-xs font-light opacity-50">
                Showing {view.items.length}
                {cursor ? " from cursor" : ""}
              </span>
            ) : null}
          </div>

          {view.items.length === 0 ? (
            <EmptyState tab={tab} usingSavedView={usingSavedView} />
          ) : (
            <ul className="space-y-3">
              {view.items.map((item) => (
                <WorkItemCard key={item.id} item={item} />
              ))}
            </ul>
          )}

          {view.nextCursor ? (
            <div className="mt-6">
              <PillLink
                href={
                  view.activeSavedView
                    ? inboxHref({ view: view.activeSavedView.id, cursor: view.nextCursor })
                    : inboxHref({ tab, cursor: view.nextCursor })
                }
              >
                Load 200 more
              </PillLink>
            </div>
          ) : null}
        </section>
      </PageBody>
    </>
  );
}

function EmptyState({ tab, usingSavedView }: { tab: InboxTab; usingSavedView: boolean }) {
  const message = usingSavedView
    ? "No work items match this saved view right now."
    : {
        replies: "No replies waiting. When a contact answers our outreach it lands here.",
        unmatched: "No unmatched inbound. Everything coming in has been attached to a thread.",
        approvals: "No drafts waiting on you. Auto-generated drafts that need a decision show here.",
        attention: "Nothing blocked. Policy, scope, and provider issues surface here.",
        all: "The queue is empty — nothing open."
      }[tab];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      <div className="text-3xl mb-3 opacity-40">✓</div>
      <p className="text-sm font-light opacity-60 max-w-md mx-auto">{message}</p>
    </div>
  );
}

function WorkItemCard({ item }: { item: InboxWorkItemRow }) {
  const meta = workItemMeta(item.type);
  const tone = TONE_CLASSES[meta.tone];
  const prio = priorityMeta(item.priority);
  const hasInbound = Boolean(item.inboundFromEmail || item.inboundSnippet);

  return (
    <li className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_12px_40px_rgba(0,0,0,0.3)] transition-colors hover:bg-white/[0.05]">
      {/* tone bar */}
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${tone.bar}`} aria-hidden />
      <div className="p-5 pl-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.chip}`}
          >
            <span aria-hidden>{meta.glyph}</span>
            {meta.label}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${prio.cls}`}>
              {prio.label}
            </span>
            <Badge>{item.status}</Badge>
          </div>
        </div>

        <Link
          href={`/work-items/${item.id}`}
          className="block text-base font-semibold leading-snug hover:text-[var(--accent)] hover:no-underline"
        >
          {item.title}
        </Link>

        {hasInbound ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="opacity-50">✉</span>
              {item.inboundFromEmail ? (
                <span className="font-medium text-white/85">{item.inboundFromEmail}</span>
              ) : null}
              {item.inboundSubject ? (
                <span className="opacity-55">· {item.inboundSubject}</span>
              ) : null}
            </div>
            {item.inboundSnippet ? (
              <p className="mt-1.5 text-sm font-light italic opacity-75 leading-relaxed">
                “{item.inboundSnippet}”
              </p>
            ) : null}
          </div>
        ) : item.summary ? (
          <p className="mt-2 text-sm font-light opacity-75 leading-relaxed">{item.summary}</p>
        ) : null}

        {/* When there's an inbound preview we still want the summary's guidance. */}
        {hasInbound && item.summary ? (
          <p className="mt-2 text-xs font-light opacity-50 leading-relaxed">{item.summary}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={`/work-items/${item.id}`}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold tracking-wide text-black transition-opacity hover:opacity-90 hover:no-underline"
          >
            {item.actionLabel ?? "Open"} →
          </Link>
          <form action="/api/work-items" method="post" className="m-0">
            <input type="hidden" name="workItemId" value={item.id} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={buildWorkItemActionIdempotencyKey(item.id, "resolve", item.updatedAt)}
            />
            <Button
              type="submit"
              name="action"
              value="resolve"
              tone="ghost"
              size="sm"
              title="Done — handled this item, closes it for good"
            >
              Done
            </Button>
          </form>
          <form action="/api/work-items" method="post" className="m-0">
            <input type="hidden" name="workItemId" value={item.id} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={buildWorkItemActionIdempotencyKey(item.id, "snooze", item.updatedAt)}
            />
            <input type="hidden" name="snoozeMinutes" value="1440" />
            <Button
              type="submit"
              name="action"
              value="snooze"
              tone="ghost"
              size="sm"
              title="Hide for 1 day, then it comes back to the queue automatically"
            >
              Later (1d)
            </Button>
          </form>
          <form action="/api/work-items" method="post" className="m-0 ml-auto">
            <input type="hidden" name="workItemId" value={item.id} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={buildWorkItemActionIdempotencyKey(item.id, "dismiss", item.updatedAt)}
            />
            <Button
              type="submit"
              name="action"
              value="dismiss"
              tone="danger"
              size="sm"
              title="Not relevant — closes and drops it (won't come back)"
            >
              Discard
            </Button>
          </form>
        </div>
      </div>
    </li>
  );
}

// Saved-views management lives in a drawer so the page stays clean. The create
// form + the editable list of existing views all live behind one toolbar pill.
function SavedViewsDrawer({ savedViews }: { savedViews: InboxSavedView[] }) {
  return (
    <SideDrawer
      triggerLabel={`Saved views (${savedViews.length})`}
      triggerVariant="inline"
      title="Saved views"
      description="Reusable filters over the live work-item queue. Fill any subset of fields — empty means no restriction on that axis."
    >
      <form action="/api/inbox-views" method="post" className="grid gap-3">
        <input type="hidden" name="operatorId" value={DEFAULT_INBOX_OPERATOR_ID} />
        <Field label="View name" hint="What this view is labelled in the toolbar.">
          <input className={inputClass} name="name" placeholder="e.g. Hot replies" />
        </Field>
        <Field label="Types" hint="Work-item type filter, comma-separated. Empty matches all.">
          <input className={inputClass} name="types" placeholder="warm_reply_review_needed, …" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Statuses" hint="open, blocked, snoozed…">
            <input className={inputClass} name="statuses" placeholder="open" />
          </Field>
          <Field label="Min priority" hint="0–100. Hides below.">
            <input className={inputClass} name="priorityMin" placeholder="70" />
          </Field>
        </div>
        <Field label="From email contains" hint="Substring match on inbound sender.">
          <input className={inputClass} name="fromEmail" placeholder="@acme.com" />
        </Field>
        <Field label="Campaign ids" hint="Restrict to campaigns, comma-separated.">
          <input className={inputClass} name="campaignIds" placeholder="uuid, uuid" />
        </Field>
        <Button type="submit" name="action" value="create" tone="primary">
          Create view
        </Button>
      </form>

      <div className="mt-8">
        <div className="text-xs font-semibold tracking-[0.2em] uppercase opacity-60 mb-3">
          Existing views
        </div>
        {savedViews.length === 0 ? (
          <p className="text-sm font-light opacity-60">No saved views yet.</p>
        ) : (
          <div className="space-y-3">
            {savedViews.map((saved) => (
              <details key={saved.id} className="rounded-lg border border-white/10 bg-black/20 p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  {saved.name}
                  <span className="ml-2 font-light opacity-60">{filterSummary(saved.filterJson)}</span>
                </summary>
                <form action="/api/inbox-views" method="post" className="mt-4 grid gap-3">
                  <input type="hidden" name="operatorId" value={DEFAULT_INBOX_OPERATOR_ID} />
                  <input type="hidden" name="viewId" value={saved.id} />
                  <Field label="View name">
                    <input className={inputClass} name="name" defaultValue={saved.name} />
                  </Field>
                  <Field label="Types">
                    <input className={inputClass} name="types" defaultValue={filterFieldValue(saved, "types")} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Statuses">
                      <input className={inputClass} name="statuses" defaultValue={filterFieldValue(saved, "statuses")} />
                    </Field>
                    <Field label="Min priority">
                      <input className={inputClass} name="priorityMin" defaultValue={filterFieldValue(saved, "priorityMin")} />
                    </Field>
                  </div>
                  <Field label="From email contains">
                    <input className={inputClass} name="fromEmail" defaultValue={filterFieldValue(saved, "fromEmail")} />
                  </Field>
                  <Field label="Campaign ids">
                    <input className={inputClass} name="campaignIds" defaultValue={filterFieldValue(saved, "campaignIds")} />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" name="action" value="update" tone="primary">
                      Save
                    </Button>
                    <Button type="submit" name="action" value="delete" tone="danger">
                      Delete
                    </Button>
                  </div>
                </form>
              </details>
            ))}
          </div>
        )}
      </div>
    </SideDrawer>
  );
}
