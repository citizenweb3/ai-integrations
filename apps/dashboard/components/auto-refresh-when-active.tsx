"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// T-026AM: tiny polling component. Whenever the server-rendered page
// reports that some background work is in flight (`active=true`), this
// component triggers `router.refresh()` every `intervalMs` so the
// operator sees the latest state without manually pressing reload. When
// the work finishes (the next refresh returns `active=false`) the
// interval clears itself.
//
// Server-Sent Events would be smoother but cost a long-lived connection
// per tab; this MVP relies on Next's RSC refresh which only re-runs the
// server component and reconciles the diff. No client cache to manage.
export function AutoRefreshWhenActive({
  active,
  intervalMs = 5000
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
