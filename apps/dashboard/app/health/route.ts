import { getSystemHealth } from "@bizdev/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type DashboardHealthSnapshot = Awaited<ReturnType<typeof getSystemHealth>>;

export function evaluateDashboardHealthOk(
  health: DashboardHealthSnapshot,
  deadLetteredThreshold = readDeadLetteredThreshold()
): boolean {
  return health.database.ok
    && health.schema.compatible
    && health.workers.healthy >= 1
    && health.jobs.deadLettered <= deadLetteredThreshold;
}

export async function GET() {
  try {
    const health = await getSystemHealth();
    const ok = evaluateDashboardHealthOk(health);

    return NextResponse.json({
      ok,
      checkedAt: health.checkedAt,
      database: health.database,
      workers: health.workers,
      jobs: health.jobs,
      webhooks: health.webhooks,
      suppressions: health.suppressions,
      schema: health.schema
    }, { status: ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      database: { ok: false },
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date()
    }, { status: 503 });
  }
}

function readDeadLetteredThreshold(): number {
  const parsed = Number(process.env.HEALTH_DEAD_LETTERED_THRESHOLD ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
