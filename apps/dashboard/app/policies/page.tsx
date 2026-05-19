import { getPoliciesView } from "@bizdev/db";
import {
  buildClearSuppressionIdempotencyKey,
  buildResolvePolicyStateIdempotencyKey,
  suppressionReasons
} from "@bizdev/shared";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Button, MetricCard, PageBody, inputClass, textareaClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const view = await getPoliciesView();

  return (
    <>
      <ConsoleHero
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Policies
          </>
        }
        title="Policies"
        subtitle="Suppression list and policy-state entries enforced before send."
      />

      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Active suppressions" value={view.suppressions.active.length} />
          <MetricCard label="Inactive suppressions" value={view.suppressions.inactive.length} />
          <MetricCard label="Active policy states" value={view.policyStates.active.length} />
          <MetricCard label="Resolved policy states" value={view.policyStates.resolved.length} />
        </div>

        <Card>
          <BlockTitle title="Add suppression" className="mb-4 text-left" />
          <form action="/api/commands" method="post" className="space-y-3">
            <input type="hidden" name="commandType" value="suppress_contact" />
            <input className={inputClass} name="email" type="email" placeholder="email@example.com" required />
            <select className={inputClass} name="reason" required defaultValue="manual_block">
              {suppressionReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input className={inputClass} name="source" placeholder="source (default: operator)" />
            <textarea className={textareaClass} name="notes" placeholder="Notes (optional)" />
            <Button type="submit">Suppress</Button>
          </form>
        </Card>

        <Card>
          <BlockTitle title="Active suppressions" className="mb-4 text-left" />
          {view.suppressions.active.length === 0 ? (
            <p className="text-sm font-light opacity-60">No active suppressions.</p>
          ) : (
            <ul className="space-y-3">
              {view.suppressions.active.map((s) => (
                <li key={s.id} className="border border-white/10 rounded-xl p-4 bg-black/30 space-y-2">
                  <div className="flex justify-between gap-3">
                    <strong className="font-medium break-all">{s.email}</strong>
                    <span className="text-xs opacity-60 whitespace-nowrap">
                      {s.reason} · {s.source}
                    </span>
                  </div>
                  <div className="text-xs opacity-60">since {s.createdAt.toISOString()}</div>
                  <form action="/api/commands" method="post" className="flex gap-2 items-center">
                    <input type="hidden" name="commandType" value="clear_suppression" />
                    <input type="hidden" name="suppressionId" value={s.id} />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={buildClearSuppressionIdempotencyKey(s.id, s.updatedAt)}
                    />
                    <input
                      className={`${inputClass} flex-1`}
                      name="reasonText"
                      placeholder="Reason for clearing (optional)"
                    />
                    <Button type="submit" tone="ghost" size="sm">
                      Clear
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Active policy states" className="mb-4 text-left" />
          {view.policyStates.active.length === 0 ? (
            <p className="text-sm font-light opacity-60">No active policy states.</p>
          ) : (
            <ul className="space-y-3">
              {view.policyStates.active.map((p) => (
                <li key={p.id} className="border border-white/10 rounded-xl p-4 bg-black/30 space-y-2">
                  <div className="flex justify-between gap-3">
                    <strong className="font-medium">{p.stateType}</strong>
                    <span className="text-xs opacity-60">
                      {p.scopeType}
                      {p.scopeKey ? ` · ${p.scopeKey}` : ""}
                      {p.scopeId ? ` · ${p.scopeId}` : ""}
                    </span>
                  </div>
                  <div className="text-xs opacity-60">
                    {p.reasonCode}
                    {p.reasonText ? ` — ${p.reasonText}` : ""}
                  </div>
                  <div className="text-xs opacity-60">
                    effective {p.effectiveAt.toISOString()}
                    {p.expiresAt ? ` · expires ${p.expiresAt.toISOString()}` : ""} · by {p.createdByType}
                  </div>
                  <form action="/api/commands" method="post" className="flex gap-2 items-center">
                    <input type="hidden" name="commandType" value="resolve_policy_state" />
                    <input type="hidden" name="policyStateId" value={p.id} />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={buildResolvePolicyStateIdempotencyKey(p.id, p.updatedAt)}
                    />
                    <input
                      className={`${inputClass} flex-1`}
                      name="reasonText"
                      placeholder="Resolution note (optional)"
                    />
                    <Button type="submit" tone="ghost" size="sm">
                      Resolve
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Recently resolved policy states" className="mb-4 text-left" />
          {view.policyStates.resolved.length === 0 ? (
            <p className="text-sm font-light opacity-60">No resolved policy states.</p>
          ) : (
            <ul className="space-y-3">
              {view.policyStates.resolved.slice(0, 50).map((p) => (
                <li key={p.id} className="border border-white/10 rounded-xl p-4 bg-black/30 space-y-1">
                  <div className="flex justify-between gap-3">
                    <strong className="font-medium">{p.stateType}</strong>
                    <span className="text-xs opacity-60">{p.status}</span>
                  </div>
                  <div className="text-xs opacity-60">
                    {p.scopeType}
                    {p.scopeKey ? ` · ${p.scopeKey}` : ""}
                    {p.scopeId ? ` · ${p.scopeId}` : ""}
                  </div>
                  <div className="text-xs opacity-60">
                    {p.reasonCode}
                    {p.resolvedAt ? ` · resolved ${p.resolvedAt.toISOString()}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Inactive suppressions" className="mb-4 text-left" />
          {view.suppressions.inactive.length === 0 ? (
            <p className="text-sm font-light opacity-60">No inactive suppressions.</p>
          ) : (
            <ul className="space-y-2">
              {view.suppressions.inactive.slice(0, 50).map((s) => (
                <li
                  key={s.id}
                  className="flex justify-between gap-3 border-b border-white/10 pb-2 last:border-b-0 text-sm"
                >
                  <strong className="font-medium break-all">{s.email}</strong>
                  <span className="text-xs opacity-60 whitespace-nowrap">
                    {s.reason} · cleared {s.updatedAt.toISOString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  );
}
