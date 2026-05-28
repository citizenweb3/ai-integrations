import { FC, ReactNode } from "react";
import Link from "next/link";

interface OwnProps {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  // Active nav segment — pass one of the nav keys to highlight the current
  // route. Optional so existing pages that don't pass it still render fine.
  currentNav?: NavKey;
}

type NavKey =
  | "console"
  | "inbox"
  | "campaigns"
  | "drafts"
  | "organizations"
  | "policies"
  | "operations";

const ConsoleHero: FC<OwnProps> = ({ eyebrow, title, subtitle, actions, currentNav }) => {
  // Server-side render timestamp. The page is `force-dynamic` so this reflects
  // the actual request time; "Rendered" wording makes the static nature
  // explicit (vs. pretending to tick live).
  const renderedAt = new Date();
  const stamp = renderedAt.toISOString().slice(11, 19) + " UTC";

  return (
    <section className="terminal-grid relative pt-20 pb-14">
      <ConsoleNav {...(currentNav ? { currentNav } : {})} />
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
        <div className="lg:col-span-8">
          {eyebrow ? (
            <div
              className="font-mono text-[10px] tracking-[0.3em] uppercase text-[var(--accent)]/90 mb-4 terminal-rise"
              style={{ animationDelay: "0.05s" }}
            >
              {eyebrow}
            </div>
          ) : null}
          <h1
            className="font-display font-normal text-5xl md:text-6xl lg:text-[5.25rem] leading-[0.95] tracking-tight terminal-rise"
            style={{ animationDelay: "0.1s" }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              className="font-display italic text-lg md:text-xl opacity-70 max-w-2xl mt-5 leading-snug terminal-rise"
              style={{ animationDelay: "0.2s" }}
            >
              {subtitle}
            </p>
          ) : null}
          {actions ? (
            <div className="mt-8 flex flex-wrap gap-3 terminal-rise" style={{ animationDelay: "0.3s" }}>
              {actions}
            </div>
          ) : null}
        </div>
        <div
          className="lg:col-span-4 terminal-rise"
          style={{ animationDelay: "0.35s" }}
        >
          <LivePulse stamp={stamp} />
        </div>
      </div>
    </section>
  );
};

const NAV_ITEMS: { key: NavKey; label: string; href: string }[] = [
  { key: "console", label: "Console", href: "/" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "campaigns", label: "Campaigns", href: "/campaigns" },
  { key: "drafts", label: "Drafts", href: "/drafts" },
  { key: "organizations", label: "Organizations", href: "/organizations" },
  { key: "policies", label: "Policies", href: "/policies" },
  { key: "operations", label: "Operations", href: "/operations" }
];

const ConsoleNav: FC<{ currentNav?: NavKey }> = ({ currentNav }) => {
  return (
    <nav className="absolute top-5 left-0 right-0 z-30">
      <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center gap-x-1 gap-y-2">
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.25em] text-[var(--accent)] mr-6 hover:no-underline"
        >
          BIZDEV<span className="opacity-50">.</span>OPS
        </Link>
        {NAV_ITEMS.map((item) => {
          const active = currentNav === item.key;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "font-mono text-[11px] tracking-[0.15em] uppercase px-3 py-1.5 transition-colors hover:no-underline " +
                (active
                  ? "text-foreground border-b border-[var(--accent)]"
                  : "text-foreground/55 border-b border-transparent hover:text-foreground hover:border-white/20")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

const LivePulse: FC<{ stamp: string }> = ({ stamp }) => {
  return (
    <div className="border border-white/10 bg-[var(--surface-1)] rounded-md p-5 text-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase opacity-50">
          System
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] opacity-70">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] terminal-pulse" />
          LIVE
        </span>
      </div>
      <dl className="space-y-2 font-mono text-xs">
        <Row k="Rendered" v={stamp} />
        <Row k="Build" v="local-dev" />
        <Row k="Mode" v="zero-autosend" />
      </dl>
    </div>
  );
};

const Row: FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex justify-between items-baseline gap-3 border-b border-dashed border-white/[0.08] last:border-0 pb-1.5 last:pb-0">
    <dt className="opacity-50">{k}</dt>
    <dd className="text-foreground/90">{v}</dd>
  </div>
);

export default ConsoleHero;
