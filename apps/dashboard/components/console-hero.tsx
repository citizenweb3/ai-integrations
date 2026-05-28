import { FC, ReactNode } from "react";
import Link from "next/link";

type NavKey =
  | "console"
  | "inbox"
  | "campaigns"
  | "drafts"
  | "organizations"
  | "policies"
  | "operations";

interface OwnProps {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  // Optional: highlights the active nav item. Pages opt in by passing this.
  currentNav?: NavKey;
}

const ConsoleHero: FC<OwnProps> = ({ eyebrow, title, subtitle, actions, currentNav }) => {
  return (
    <section className="mesh-bg relative pt-24 pb-12">
      <ConsoleNav {...(currentNav ? { currentNav } : {})} />
      <div className="max-w-[88vw] mx-auto px-4">
        {eyebrow ? (
          <div className="text-xs font-semibold tracking-[0.2em] uppercase text-[hsl(var(--primary))] mb-3">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-bold text-4xl md:text-5xl tracking-[0.02em] opacity-95 mb-4">
          {title}
        </h1>
        {subtitle ? (
          <p className="font-light text-lg md:text-xl opacity-80 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        ) : null}
        {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
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
    <nav className="absolute top-6 left-0 right-0 z-30">
      <div className="max-w-[88vw] mx-auto px-4 flex flex-wrap gap-2 items-center">
        <Link
          href="/"
          className="text-base font-bold tracking-[0.1em] hover:no-underline mr-4 text-[var(--accent)]"
        >
          BIZDEV.OPS
        </Link>
        {NAV_ITEMS.map((item) => {
          const active = currentNav === item.key;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "px-4 py-1.5 rounded-[10px] text-sm font-medium hover:no-underline transition-colors " +
                (active
                  ? "bg-[#262626] text-[var(--accent)]"
                  : "bg-[#1A1A1B] border-b border-[#262626] hover:bg-[#262626]")
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

export default ConsoleHero;
