"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

// Tiny client component that calls `router.back()` on click. Falls back
// to a configurable `fallbackHref` if the browser has no prior history
// (e.g. operator opened the page in a new tab / followed a deep link).
//
// Lives at the top of detail pages so the operator always has a one-
// click escape from a deep page without having to chase the breadcrumb
// through multiple jumps.
export function BackLink({
  fallbackHref,
  label = "← Back"
}: {
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      // History length of 1 means only the current entry exists (no real
      // back target). Anything higher means we can router.back().
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push(fallbackHref);
      }
    },
    [router, fallbackHref]
  );
  return (
    <a
      href={fallbackHref}
      onClick={handleClick}
      className="text-sm font-light opacity-70 hover:opacity-100 underline decoration-dotted"
    >
      {label}
    </a>
  );
}
