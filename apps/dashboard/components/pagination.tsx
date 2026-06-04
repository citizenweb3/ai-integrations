import Link from "next/link";

// Server-rendered pagination control. Plain links so it works without
// client JS and survives the auto-refresh that runs while background work
// is in flight. The caller supplies `hrefFor(page)` so the control can
// preserve whatever other query params the page uses (filters, other
// paginated lists on the same page, etc.).
//
// Links use scroll={false} so paging keeps the viewport in place instead
// of jumping to the top — the operator stays where the list is.
//
// Renders nothing when there is at most one page.
export function Pagination({
  page,
  totalPages,
  hrefFor
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return null;
  }
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  const navClass =
    "inline-flex items-center gap-1 rounded-[10px] border border-white/15 px-4 py-2 text-sm font-medium hover:bg-white/5 hover:no-underline transition-colors";
  const disabledClass =
    "inline-flex items-center gap-1 rounded-[10px] border border-white/10 px-4 py-2 text-sm font-medium opacity-30 cursor-not-allowed";

  return (
    <nav
      className="flex items-center justify-center gap-4 pt-2"
      aria-label="Pagination"
    >
      {atStart ? (
        <span className={disabledClass} aria-disabled="true">
          ‹ Prev
        </span>
      ) : (
        <Link href={hrefFor(prev)} className={navClass} rel="prev" scroll={false}>
          ‹ Prev
        </Link>
      )}
      <span className="text-sm font-light opacity-70 tabular-nums">
        Page {page} / {totalPages}
      </span>
      {atEnd ? (
        <span className={disabledClass} aria-disabled="true">
          Next ›
        </span>
      ) : (
        <Link href={hrefFor(next)} className={navClass} rel="next" scroll={false}>
          Next ›
        </Link>
      )}
    </nav>
  );
}
