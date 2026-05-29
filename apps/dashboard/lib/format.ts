// T-026AD/E: small formatting helpers used across the operator console.
// Kept dependency-free so server components can import without pulling in
// extra runtime weight.

// Formats a Date as a human-readable "X seconds/minutes/hours/days ago"
// string anchored to a reference time (defaults to "now"). The reference
// time can be injected for snapshot-stable rendering in tests; otherwise
// `Date.now()` is read at call time.
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  // Treat tiny negative skews (clock drift between SSR and the persisted
  // job row) as "just now" instead of "-2s ago".
  if (diffMs < 1000) {
    return "just now";
  }
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
