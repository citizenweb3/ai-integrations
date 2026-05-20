import { getPrometheusMetricsSnapshot, renderPrometheusMetrics } from "@bizdev/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const snapshot = await getPrometheusMetricsSnapshot();
  return new NextResponse(renderPrometheusMetrics(snapshot), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
