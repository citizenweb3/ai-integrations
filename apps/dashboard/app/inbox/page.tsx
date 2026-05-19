import { getInboxView, inboxTabs, type InboxTab } from "@bizdev/db";
import { buildWorkItemActionIdempotencyKey } from "@bizdev/shared";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, PageBody } from "@/components/ui";

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

type Props = { searchParams: Promise<{ tab?: string | string[] }> };

export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const view = await getInboxView(tab);

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
        subtitle={`Filtered by ${tabLabels[tab]}`}
      />

      <PageBody>
        <Card>
          <BlockTitle title="Tabs" className="mb-4 text-left" />
          <div className="flex flex-wrap gap-2">
            {inboxTabs.map((t) => {
              const active = t === tab;
              return (
                <Link
                  key={t}
                  href={`/inbox?tab=${t}`}
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
          </div>
        </Card>

        <Card>
          <BlockTitle
            title={`${tabLabels[tab]} (${view.items.length})`}
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
        </Card>
      </PageBody>
    </>
  );
}
