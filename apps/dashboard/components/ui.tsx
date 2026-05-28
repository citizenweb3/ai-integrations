import { FC, PropsWithChildren, ReactNode } from "react";
import Link from "next/link";
import { twMerge } from "tailwind-merge";

export const inputClass =
  "w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm font-light text-foreground placeholder:opacity-50 focus:outline-none focus:border-[var(--accent)]/60 transition-colors";

export const textareaClass =
  "w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm font-light text-foreground placeholder:opacity-50 focus:outline-none focus:border-[var(--accent)]/60 transition-colors min-h-24 resize-y";

export const Button: FC<
  PropsWithChildren<{
    type?: "submit" | "button" | "reset";
    name?: string;
    value?: string;
    tone?: "primary" | "ghost" | "danger" | "muted";
    size?: "sm" | "md";
    className?: string;
  }>
> = ({ children, type = "submit", name, value, tone = "primary", size = "md", className }) => {
  const sizes = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm";
  const tones = {
    primary: "bg-[var(--accent)] text-black hover:opacity-90",
    ghost: "bg-transparent border border-white/15 text-white hover:bg-white/5",
    danger: "bg-[#7f2d20] text-white hover:opacity-90",
    muted: "bg-[#1A1A1B] border-b border-[#262626] text-white hover:bg-[#262626]"
  }[tone];
  return (
    <button
      type={type}
      name={name}
      value={value}
      className={twMerge(
        "rounded-lg font-bold tracking-wide transition-colors hover:no-underline",
        sizes,
        tones,
        className
      )}
    >
      {children}
    </button>
  );
};

export const PillLink: FC<{
  href: string;
  children: ReactNode;
  primary?: boolean;
  className?: string;
}> = ({ href, children, primary = false, className }) => {
  const tone = primary
    ? "bg-[var(--accent)] text-black hover:opacity-90"
    : "bg-[#1A1A1B] border-b border-[#262626] text-white hover:bg-[#262626]";
  return (
    <Link
      href={href}
      className={twMerge(
        "px-5 py-2 rounded-[10px] text-sm font-semibold tracking-wide transition-colors hover:no-underline inline-block",
        tone,
        className
      )}
    >
      {children}
    </Link>
  );
};

export const Badge: FC<{
  children: ReactNode;
  tone?: "default" | "accent" | "primary" | "warning" | "danger";
  className?: string;
}> = ({ children, tone = "default", className }) => {
  const tones = {
    default: "border-white/20 text-white/70",
    accent: "border-[var(--accent)]/40 text-[var(--accent)]",
    primary: "border-[hsl(var(--primary))]/40 text-[hsl(var(--primary))]",
    warning: "border-yellow-500/40 text-yellow-400",
    danger: "border-red-500/40 text-red-400"
  }[tone];
  return (
    <span
      className={twMerge(
        "inline-flex items-center text-xs px-2 py-0.5 rounded-full border whitespace-nowrap",
        tones,
        className
      )}
    >
      {children}
    </span>
  );
};

export const SectionGrid: FC<PropsWithChildren<{ cols?: 2 | 3 | 4; className?: string }>> = ({
  children,
  cols = 2,
  className
}) => {
  const colsCls = {
    2: "grid-cols-1 lg:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4"
  }[cols];
  return <div className={twMerge("grid gap-6", colsCls, className)}>{children}</div>;
};

export const PageBody: FC<PropsWithChildren<{ className?: string }>> = ({ children, className }) => {
  return <section className={twMerge("max-w-[80vw] mx-auto px-4 pb-24 space-y-8", className)}>{children}</section>;
};

export const MetricCard: FC<{ label: string; value: number | string; accent?: boolean }> = ({
  label,
  value,
  accent = false
}) => {
  return (
    <div className="rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
      <div className={`text-3xl font-bold ${accent ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">{label}</div>
    </div>
  );
};

export const InfoRow: FC<{ label: string; value: ReactNode; className?: string }> = ({ label, value, className }) => {
  return (
    <div className={twMerge("flex justify-between items-center gap-4 border-b border-white/10 py-2 text-sm last:border-b-0", className)}>
      <span className="opacity-60">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
};

// Editorial section label: tiny mono uppercase tag + a hairline that runs to
// the right edge. Sets a deliberate rhythm without competing with the data.
export const SectionLabel: FC<PropsWithChildren<{ muted?: boolean; meta?: ReactNode }>> = ({
  children,
  muted = false,
  meta
}) => {
  return (
    <div className="flex items-center gap-4 mb-5">
      <span
        className={twMerge(
          "font-mono text-[10px] tracking-[0.3em] uppercase shrink-0",
          muted ? "opacity-40" : "opacity-70"
        )}
      >
        {children}
      </span>
      <span className="flex-1 h-px hairline" />
      {meta ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-50 shrink-0">
          {meta}
        </span>
      ) : null}
    </div>
  );
};

// Primary attention surface — one of the three "needs you" callouts at the
// top of the console. Large mono numeral, label below, optional sublabel
// gives context. Whole tile is a link; the border picks up the accent when
// the value is non-zero so the eye lands on what matters first.
export const TriageCallout: FC<{
  label: string;
  value: number;
  sublabel?: string;
  href: string;
  tone?: "neutral" | "accent" | "danger";
}> = ({ label, value, sublabel, href, tone = "neutral" }) => {
  const palette =
    tone === "danger"
      ? "border-red-500/45 bg-red-500/[0.06] hover:border-red-400"
      : tone === "accent"
        ? "border-[var(--accent)]/40 bg-[var(--accent)]/[0.04] hover:border-[var(--accent)]"
        : "border-white/[0.08] bg-[var(--surface-1)] hover:border-white/25";
  const numberColor =
    tone === "danger" ? "text-red-400" : tone === "accent" ? "text-[var(--accent)]" : "text-foreground";
  return (
    <Link
      href={href}
      className={twMerge(
        "group block rounded-md border p-6 transition-colors hover:no-underline",
        palette
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className={twMerge("font-mono text-5xl tabular-nums tracking-tight", numberColor)}>
          {value}
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-40 group-hover:opacity-80 transition-opacity">
          drill in →
        </span>
      </div>
      <div className="mt-5">
        <div className="font-display text-xl leading-tight">{label}</div>
        {sublabel ? (
          <div className="font-mono text-[11px] mt-1 opacity-60">{sublabel}</div>
        ) : null}
      </div>
    </Link>
  );
};

// Compact list for the activity feeds. Empty state owns its own copy so the
// page can be expressive about *why* the list is empty.
export const ActivityList: FC<{
  title: string;
  empty: string;
  items: Array<{ id: string; primary: string; secondary: string }>;
  meta?: ReactNode;
}> = ({ title, empty, items, meta }) => {
  return (
    <div>
      <SectionLabel meta={meta}>{title}</SectionLabel>
      {items.length === 0 ? (
        <p className="font-display italic text-sm opacity-60 px-1">{empty}</p>
      ) : (
        <ul className="space-y-px">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[var(--surface-1)]/60 border-l border-white/[0.06] hover:border-l-[var(--accent)] transition-colors"
            >
              <span className="font-mono text-xs truncate">{item.primary}</span>
              <span className="font-mono text-[10px] opacity-50 shrink-0 truncate max-w-[55%] text-right">
                {item.secondary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// Bottom-of-page secondary stats. De-emphasized on purpose.
export const SecondaryStat: FC<{ label: string; value: number | string; muted?: boolean }> = ({
  label,
  value,
  muted = false
}) => {
  return (
    <div
      className={twMerge(
        "flex items-baseline justify-between border-b border-white/[0.08] pb-2.5",
        muted && "opacity-50"
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">{label}</span>
      <span className="font-mono text-xl tabular-nums">{value}</span>
    </div>
  );
};
