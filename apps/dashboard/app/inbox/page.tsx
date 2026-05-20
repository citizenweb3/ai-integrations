import {
  DEFAULT_INBOX_OPERATOR_ID,
  getInboxView,
  inboxTabs,
  type InboxSavedView,
  type InboxTab,
  type InboxViewFilter
} from "@bizdev/db";
import { buildWorkItemActionIdempotencyKey } from "@bizdev/shared";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, PageBody, PillLink, inputClass } from "@/components/ui";

export const dynamic = "force-dynamic";

const tabLabels: Record<InboxTab, string> = {
  needs_reply: "Needs reply",
  awaiting_approval: "Awaiting approval",
  low_confidence: "Low confidence",
  manual_hold: "Manual hold",
  all: "All open"
};

function priorityBand(priority: number) {
  if (priority >= 90) return "P0";
  if (priority >= 70) return "P1";
  if (priority >= 40) return "P2";
  return "P3";
}

function parseTab(value: string | string[] | undefined): InboxTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (inboxTabs as readonly string[]).includes(candidate ?? "")
    ? (candidate as InboxTab)
    : "needs_reply";
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
    params.set("tab", input.tab ?? "needs_reply");
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

  return (
    <>
      <ConsoleHero
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Inbox
          </>
        }
        title="Operator Inbox"
        subtitle={view.activeSavedView ? `Saved view: ${activeLabel}` : `Filtered by ${activeLabel}`}
      />

      <PageBody>
        <Card>
          <BlockTitle title="Views" className="mb-4 text-left" />
          <div className="flex flex-wrap gap-2">
            {inboxTabs.map((t) => {
              const active = !view.activeSavedView && t === tab;
              return (
                <Link
                  key={t}
                  href={inboxHref({ tab: t })}
                  className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-colors hover:no-underline ${
                    active
                      ? "bg-[var(--accent)] text-black"
                      : "bg-[#1A1A1B] border-b border-[#262626] text-white hover:bg-[#262626]"
                  }`}
                >
                  {tabLabels[t]} ({view.counts[t]})
                </Link>
              );
            })}
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
                  {saved.name}
                </Link>
              );
            })}
          </div>
        </Card>

        <Card>
          <BlockTitle title="Saved Views" className="mb-4 text-left" />
          {error ? (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          <form action="/api/inbox-views" method="post" className="grid gap-3 lg:grid-cols-6">
            <input type="hidden" name="operatorId" value={DEFAULT_INBOX_OPERATOR_ID} />
            <input className={inputClass} name="name" placeholder="View name" />
            <input className={inputClass} name="types" placeholder="types, comma-separated" />
            <input className={inputClass} name="statuses" placeholder="statuses" />
            <input className={inputClass} name="priorityMin" placeholder="min priority" />
            <input className={inputClass} name="fromEmail" placeholder="from email contains" />
            <Button type="submit" name="action" value="create" tone="primary">
              Create view
            </Button>
            <input className={`${inputClass} lg:col-span-6`} name="campaignIds" placeholder="campaign ids, comma-separated" />
          </form>

          {view.savedViews.length === 0 ? (
            <p className="mt-4 text-sm font-light opacity-60">No saved views yet.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {view.savedViews.map((saved) => (
                <details key={saved.id} className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    {saved.name}
                    <span className="ml-2 font-light opacity-60">{filterSummary(saved.filterJson)}</span>
                  </summary>
                  <form action="/api/inbox-views" method="post" className="mt-4 grid gap-3 lg:grid-cols-6">
                    <input type="hidden" name="operatorId" value={DEFAULT_INBOX_OPERATOR_ID} />
                    <input type="hidden" name="viewId" value={saved.id} />
                    <input className={inputClass} name="name" defaultValue={saved.name} />
                    <input className={inputClass} name="types" defaultValue={filterFieldValue(saved, "types")} />
                    <input className={inputClass} name="statuses" defaultValue={filterFieldValue(saved, "statuses")} />
                    <input className={inputClass} name="priorityMin" defaultValue={filterFieldValue(saved, "priorityMin")} />
                    <input className={inputClass} name="fromEmail" defaultValue={filterFieldValue(saved, "fromEmail")} />
                    <div className="flex gap-2">
                      <Button type="submit" name="action" value="update" tone="primary">
                        Save
                      </Button>
                      <Button type="submit" name="action" value="delete" tone="danger">
                        Delete
                      </Button>
                    </div>
                    <input
                      className={`${inputClass} lg:col-span-6`}
                      name="campaignIds"
                      defaultValue={filterFieldValue(saved, "campaignIds")}
                    />
                  </form>
                </details>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm font-light opacity-80">
            Total {view.totalCount} item{view.totalCount === 1 ? "" : "s"} in {activeLabel}; showing {view.items.length}
            {cursor ? " from this cursor" : ""}.
          </div>
          <BlockTitle
            title={`${activeLabel} (${view.totalCount})`}
            className="mb-4 text-left"
          />
          {view.items.length === 0 ? (
            <p className="text-sm font-light opacity-60">No work items in this tab.</p>
          ) : (
            <ul className="space-y-4">
              {view.items.map((item) => (
                <li key={item.id} className="border border-white/10 rounded-xl p-4 bg-black/30">
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <Link
                      href={`/work-items/${item.id}`}
                      className="text-base font-medium hover:text-[var(--accent)] hover:no-underline flex-1 min-w-0"
                    >
                      {item.title}
                    </Link>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-black text-xs font-bold">
                        {priorityBand(item.priority)}
                      </span>
                      <Badge>{item.status}</Badge>
                    </div>
                  </div>
                  <div className="text-xs opacity-60 mb-2">
                    {item.type} · {item.reasonCode}
                  </div>
                  {item.summary ? (
                    <div className="text-sm font-light opacity-80 mb-3">{item.summary}</div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <form action="/api/work-items" method="post" className="m-0">
                      <input type="hidden" name="workItemId" value={item.id} />
                      <input
                        type="hidden"
                        name="idempotencyKey"
                        value={buildWorkItemActionIdempotencyKey(item.id, "resolve", item.updatedAt)}
                      />
                      <Button type="submit" name="action" value="resolve" tone="primary" size="sm">
                        Resolve
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
                      <Button type="submit" name="action" value="snooze" tone="ghost" size="sm">
                        Snooze 1d
                      </Button>
                    </form>
                    <form action="/api/work-items" method="post" className="m-0">
                      <input type="hidden" name="workItemId" value={item.id} />
                      <input
                        type="hidden"
                        name="idempotencyKey"
                        value={buildWorkItemActionIdempotencyKey(item.id, "dismiss", item.updatedAt)}
                      />
                      <Button type="submit" name="action" value="dismiss" tone="danger" size="sm">
                        Dismiss
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {view.nextCursor ? (
            <div className="mt-6">
              <PillLink
                href={view.activeSavedView
                  ? inboxHref({ view: view.activeSavedView.id, cursor: view.nextCursor })
                  : inboxHref({ tab, cursor: view.nextCursor })}
              >
                Load 200 more
              </PillLink>
            </div>
          ) : null}
        </Card>
      </PageBody>
    </>
  );
}
