import { FC, ReactNode } from "react";
import Link from "next/link";

interface OwnProps {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

const ConsoleHero: FC<OwnProps> = ({ eyebrow, title, subtitle, actions }) => {
  return (
    <section className="mesh-bg relative pt-24 pb-12">
      <ConsoleNav />
      <div className="max-w-[80vw] mx-auto px-4">
        {eyebrow ? (
          <div className="text-xs font-semibold tracking-[0.2em] uppercase text-[hsl(var(--primary))] mb-3">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-bold text-4xl md:text-5xl tracking-[0.02em] opacity-95 mb-4">{title}</h1>
        {subtitle ? (
          <p className="font-light text-lg md:text-xl opacity-80 max-w-3xl leading-relaxed">{subtitle}</p>
        ) : null}
        {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </section>
  );
};

const ConsoleNav: FC = () => {
  const items = [
    { label: "Console", href: "/" },
    { label: "Inbox", href: "/inbox" },
    { label: "Campaigns", href: "/campaigns" },
    { label: "Drafts", href: "/drafts" },
    { label: "Organizations", href: "/organizations" },
    { label: "Policies", href: "/policies" },
    { label: "Operations", href: "/operations" }
  ];
  return (
    <nav className="absolute top-6 left-0 right-0 z-30">
      <div className="max-w-[80vw] mx-auto px-4 flex flex-wrap gap-2 items-center">
        <Link
          href="/"
          className="text-base font-bold tracking-[0.1em] hover:no-underline mr-4 text-[var(--accent)]"
        >
          BIZDEV.OPS
        </Link>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="px-4 py-1.5 rounded-[10px] bg-[#1A1A1B] border-b border-[#262626] text-sm font-medium hover:bg-[#262626] hover:no-underline transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
};

export default ConsoleHero;
