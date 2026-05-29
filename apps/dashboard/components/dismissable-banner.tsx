"use client";

import { useCallback } from "react";

// T-026AD/D: client component that renders an error or notice banner with a
// dismiss button. On dismiss the corresponding query-string key
// (`?error=...` or `?notice=...`) is stripped via `history.replaceState`
// so a subsequent refresh does not re-show the banner.
//
// Server-side rendering pre-fills the banner from the page-level
// searchParams; this component only owns the dismiss interaction.
export function DismissableBanner({
  tone,
  queryKey,
  eyebrow,
  message,
  hint
}: {
  tone: "error" | "notice";
  queryKey: string;
  eyebrow: string;
  message: string;
  hint?: string;
}) {
  const dismiss = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(queryKey)) return;
    url.searchParams.delete(queryKey);
    const target = url.pathname + (url.search ? url.search : "") + url.hash;
    window.history.replaceState({}, "", target);
    const node = document.querySelector(`[data-dismissable-banner="${queryKey}"]`);
    if (node) {
      (node as HTMLElement).style.display = "none";
    }
  }, [queryKey]);

  const palette = tone === "error"
    ? {
        border: "border-red-500/40",
        bg: "bg-red-500/5",
        eyebrow: "text-red-400",
        button: "border-red-500/40 text-red-400 hover:bg-red-500/10"
      }
    : {
        border: "border-[var(--accent)]/40",
        bg: "bg-[var(--accent)]/5",
        eyebrow: "text-[var(--accent)]",
        button: "border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10"
      };

  return (
    <div
      data-dismissable-banner={queryKey}
      className={`rounded-2xl border ${palette.border} ${palette.bg} p-5`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className={`text-xs font-semibold tracking-[0.2em] uppercase ${palette.eyebrow} mb-2`}>
            {eyebrow}
          </div>
          <p className="text-sm font-light opacity-90 break-words">{message}</p>
          {hint ? (
            <p className="text-xs font-light opacity-60 mt-3">{hint}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={`shrink-0 rounded-md border ${palette.button} px-2 py-1 text-xs font-semibold transition-colors`}
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
