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

export const MetricCard: FC<{
  label: string;
  value: number | string;
  accent?: boolean;
  // T-026AG/C: when set, the whole card renders as a clickable Link so
  // the operator can use the metric tile as a primary navigation
  // affordance (e.g. "Pending review" jumps to the candidate triage page).
  href?: string;
}> = ({ label, value, accent = false, href }) => {
  const content = (
    <>
      <div className={`text-3xl font-bold ${accent ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">{label}</div>
    </>
  );
  const baseClass = "block rounded-2xl bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]";
  if (href) {
    return (
      <Link
        href={href}
        className={`${baseClass} transition-colors hover:bg-white/10 hover:no-underline`}
      >
        {content}
      </Link>
    );
  }
  return <div className={baseClass}>{content}</div>;
};

export const InfoRow: FC<{ label: string; value: ReactNode; className?: string }> = ({ label, value, className }) => {
  return (
    <div className={twMerge("flex justify-between items-center gap-4 border-b border-white/10 py-2 text-sm last:border-b-0", className)}>
      <span className="opacity-60">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
};

// Form field wrapper — uppercase label above the control + optional hint
// underneath. Wrap any input/textarea/select to give it a proper visible label
// instead of relying on placeholder text alone.
export const Field: FC<
  PropsWithChildren<{
    label: string;
    hint?: ReactNode;
    required?: boolean;
    className?: string;
  }>
> = ({ label, hint, required, className, children }) => {
  return (
    <label className={twMerge("flex flex-col gap-2", className)}>
      <span className="text-xs font-semibold tracking-[0.15em] uppercase opacity-70">
        {label}
        {required ? <span className="text-[var(--accent)] ml-1">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs font-light opacity-55 leading-snug">{hint}</span> : null}
    </label>
  );
};

// Section label — uppercase tracking-wide tag with a hairline running to the
// right edge. Pairs with the existing brand language (BlockTitle uses the same
// tracking-[0.05em] / uppercase rhythm).
export const SectionLabel: FC<PropsWithChildren<{ muted?: boolean; meta?: ReactNode }>> = ({
  children,
  muted = false,
  meta
}) => {
  return (
    <div className="flex items-center gap-4 mb-5">
      <span
        className={twMerge(
          "text-xs font-semibold tracking-[0.2em] uppercase shrink-0",
          muted ? "opacity-40" : "opacity-70"
        )}
      >
        {children}
      </span>
      <span className="flex-1 h-px bg-white/10" />
      {meta ? (
        <span className="text-xs font-semibold tracking-[0.15em] uppercase opacity-50 shrink-0">
          {meta}
        </span>
      ) : null}
    </div>
  );
};

// Primary attention surface — one of the "needs you" callouts at the top of
// the console. Large bold numeral, label below, optional sublabel. Whole tile
// is a link; border picks up the accent when value is non-zero so the eye
// lands on what matters first. Uses the brand card gradient.
export const TriageCallout: FC<{
  label: string;
  value: number;
  sublabel?: string;
  href: string;
  tone?: "neutral" | "accent" | "danger";
}> = ({ label, value, sublabel, href, tone = "neutral" }) => {
  const palette =
    tone === "danger"
      ? "border-red-500/40 bg-red-500/[0.08] hover:border-red-400"
      : tone === "accent"
        ? "border-[var(--accent)]/40 bg-[var(--accent)]/[0.05] hover:border-[var(--accent)]"
        : "border-white/10 hover:border-white/25";
  const numberColor =
    tone === "danger" ? "text-red-400" : tone === "accent" ? "text-[var(--accent)]" : "text-foreground";
  return (
    <Link
      href={href}
      className={twMerge(
        "group block rounded-2xl border bg-white/5 p-8 shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-colors hover:no-underline",
        palette
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className={twMerge("text-5xl font-bold tabular-nums tracking-tight", numberColor)}>
          {value}
        </span>
        <span className="text-[10px] font-semibold tracking-[0.2em] uppercase opacity-40 group-hover:opacity-80 transition-opacity">
          drill in →
        </span>
      </div>
      <div className="mt-6">
        <div className="text-lg font-bold tracking-[0.02em]">{label}</div>
        {sublabel ? (
          <div className="text-sm font-light opacity-65 mt-1">{sublabel}</div>
        ) : null}
      </div>
    </Link>
  );
};

// Compact ordered list — used for "recent campaigns" / "active suppressions"
// surfaces. Items are dark pills with hover affordance.
export const ActivityList: FC<{
  title: string;
  empty: string;
  items: Array<{ id: string; primary: string; secondary: string; href?: string }>;
  meta?: ReactNode;
}> = ({ title, empty, items, meta }) => {
  return (
    <div>
      <SectionLabel meta={meta}>{title}</SectionLabel>
      {items.length === 0 ? (
        <p className="text-sm font-light opacity-60 px-1">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const inner = (
              <span className="flex items-center justify-between gap-3 px-4 py-3 rounded-[10px] bg-[#1A1A1B] border-b border-[#262626] hover:bg-[#262626] hover:no-underline transition-colors">
                <span className="text-sm font-medium truncate">{item.primary}</span>
                <span className="text-xs font-light opacity-60 shrink-0 truncate max-w-[55%] text-right">
                  {item.secondary}
                </span>
              </span>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="block hover:no-underline">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
