"use client";

import { useEffect, useState, type ReactNode } from "react";

// Right-side slide-in drawer for optional write actions on the draft
// detail page (and any other surface where we want to keep a long
// form out of the operator's way until they explicitly ask for it).
//
// Native <dialog> would give us backdrop + ESC for free, but its
// positioning + animation story is fiddly enough that a small
// useState-driven panel is cleaner. The trigger and the panel are
// rendered together; the trigger is just a styled button that flips
// `open` to true.
export function SideDrawer({
  triggerLabel,
  title,
  description,
  triggerTone = "ghost",
  children,
}: {
  triggerLabel: string;
  title: string;
  description?: string;
  triggerTone?: "ghost" | "danger";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    // Prevent scrolling the page underneath while the drawer is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const triggerClass =
    triggerTone === "danger"
      ? "border border-red-500/40 text-red-300 hover:bg-red-500/10"
      : "border border-white/15 text-white hover:bg-white/5";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full text-left rounded-2xl px-5 py-4 transition-colors flex items-center justify-between gap-3 ${triggerClass}`}
      >
        <span>
          <span className="block text-sm font-semibold tracking-[0.05em]">
            {triggerLabel}
          </span>
          {description ? (
            <span className="block text-xs font-light opacity-60 leading-snug mt-1">
              {description}
            </span>
          ) : null}
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] opacity-50 shrink-0">
          open →
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close drawer backdrop"
            onClick={() => setOpen(false)}
            className="flex-1 bg-black/60 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-label={title}
            className="w-full sm:w-[520px] max-w-full bg-[#0F0F10] border-l border-white/10 p-6 overflow-y-auto shadow-[0_0_60px_rgba(0,0,0,0.8)]"
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold tracking-[0.02em]">{title}</h3>
                {description ? (
                  <p className="text-xs font-light opacity-60 leading-snug mt-1">
                    {description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs uppercase tracking-[0.18em] opacity-60 hover:opacity-100 shrink-0"
              >
                Close ✕
              </button>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </>
  );
}
