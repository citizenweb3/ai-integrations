"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// T-026BS: bulk "Send all drafts" for a campaign. A prominent trigger
// opens a right-side drawer that (1) shows the mandatory pre-send
// verification warning, (2) lists every draft that will go out, and (3)
// on confirm approves each one through the existing
// approve_draft_for_send command, one at a time, reporting progress.
//
// We loop the single-draft command client-side rather than adding a new
// bulk backend command: approve_draft_for_send already validates the
// recipient + version and is idempotent (re-clicking deduplicates), so a
// sequential loop is the smallest correct implementation. Sequential,
// not parallel, to keep the worker queue ordering sane and to surface a
// clean per-draft pass/fail list.

export type SendableDraft = {
  id: string;
  version: number;
  subject: string;
  contactEmail: string;
};

type SendResult = {
  draftId: string;
  subject: string;
  ok: boolean;
  message?: string;
};

export function SendAllDraftsDrawer({ drafts }: { drafts: SendableDraft[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SendResult[]>([]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // Do not let ESC close the drawer mid-send; the loop must finish.
      if (e.key === "Escape" && !sending) setOpen(false);
    };
    document.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, sending]);

  if (drafts.length === 0) {
    return null;
  }

  const total = drafts.length;
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  async function sendAll() {
    setSending(true);
    setDone(false);
    setProgress(0);
    const collected: SendResult[] = [];
    for (const draft of drafts) {
      try {
        const res = await fetch("/api/commands", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandType: "approve_draft_for_send",
            payload: { draftId: draft.id, draftVersion: draft.version }
          })
        });
        if (res.ok) {
          collected.push({ draftId: draft.id, subject: draft.subject, ok: true });
        } else {
          const body = (await res.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          const message =
            body?.error?.message ??
            body?.error?.code ??
            `HTTP ${res.status}`;
          collected.push({ draftId: draft.id, subject: draft.subject, ok: false, message });
        }
      } catch (err) {
        collected.push({
          draftId: draft.id,
          subject: draft.subject,
          ok: false,
          message: err instanceof Error ? err.message : "network error"
        });
      }
      setProgress((p) => p + 1);
      setResults([...collected]);
    }
    setSending(false);
    setDone(true);
    // Refresh server components so draft counts + statuses reflect the
    // approvals that just happened.
    router.refresh();
  }

  function closeAndReset() {
    if (sending) return;
    setOpen(false);
    // Leave results in place briefly is unnecessary; reset so a re-open
    // starts clean.
    setDone(false);
    setProgress(0);
    setResults([]);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 py-2.5 text-sm font-bold tracking-[0.03em] text-black shadow-[0_0_24px_rgba(0,0,0,0.35)] hover:opacity-90 transition-opacity"
      >
        <span>Send all drafts</span>
        <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-bold">
          {total}
        </span>
      </button>

      <div
        className={`fixed inset-0 z-50 flex transition-opacity duration-200 ease-out ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!open}
      >
        <button
          type="button"
          aria-label="Close drawer backdrop"
          tabIndex={open ? 0 : -1}
          onClick={closeAndReset}
          className="flex-1 bg-black/60 backdrop-blur-sm"
        />
        <div
          role="dialog"
          aria-label="Send all drafts"
          aria-modal="true"
          className={`w-full sm:w-[560px] max-w-full bg-[#0F0F10] border-l border-white/10 p-6 overflow-y-auto shadow-[0_0_60px_rgba(0,0,0,0.8)] transform transition-transform duration-300 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <h3 className="text-lg font-bold tracking-[0.02em]">
              Send all drafts ({total})
            </h3>
            <button
              type="button"
              onClick={closeAndReset}
              disabled={sending}
              tabIndex={open ? 0 : -1}
              className="text-xs uppercase tracking-[0.18em] opacity-60 hover:opacity-100 shrink-0 disabled:opacity-30"
            >
              Close ✕
            </button>
          </div>

          {/* Mandatory pre-send verification warning. */}
          <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/5 p-4 mb-5">
            <div className="text-xs font-semibold tracking-[0.18em] uppercase text-yellow-400 mb-2">
              Before you send
            </div>
            <p className="text-sm font-light opacity-90 leading-snug">
              Before sending all drafts, please double-check that the contacts,
              their email addresses, and the drafts themselves are correct. This
              approves every draft below for sending and cannot be undone from
              here.
            </p>
          </div>

          {!done ? (
            <>
              <p className="text-xs font-light opacity-60 leading-snug mb-3">
                {total} draft{total === 1 ? "" : "s"} will be sent, one per
                organisation contact:
              </p>
              <ul className="space-y-2 mb-5 max-h-[40vh] overflow-y-auto">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    className="border border-white/10 rounded-lg px-3 py-2 bg-black/30"
                  >
                    <div className="text-sm font-medium break-words">{d.subject}</div>
                    <div className="text-xs opacity-60 mt-0.5">{d.contactEmail}</div>
                  </li>
                ))}
              </ul>

              {sending ? (
                <div className="text-sm font-light opacity-80 mb-4">
                  Sending… {progress} / {total}
                </div>
              ) : null}

              <button
                type="button"
                onClick={sendAll}
                disabled={sending}
                className="w-full rounded-[10px] bg-[var(--accent)] px-5 py-3 text-sm font-bold tracking-[0.03em] text-black hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {sending ? `Sending… ${progress}/${total}` : `Send all ${total} drafts`}
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4 mb-4">
                <div className="text-sm font-semibold mb-1">
                  Done — {succeeded} sent
                  {failed > 0 ? `, ${failed} failed` : ""}
                </div>
                <p className="text-xs font-light opacity-60 leading-snug">
                  Approved drafts are queued for delivery. They move through the
                  send queue and will show as sent once the worker dispatches
                  them.
                </p>
              </div>
              {failed > 0 ? (
                <ul className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto">
                  {results
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <li
                        key={r.draftId}
                        className="border border-red-500/30 rounded-lg px-3 py-2 bg-red-500/5"
                      >
                        <div className="text-sm font-medium break-words">{r.subject}</div>
                        <div className="text-xs text-red-300 mt-0.5">{r.message}</div>
                      </li>
                    ))}
                </ul>
              ) : null}
              <button
                type="button"
                onClick={closeAndReset}
                className="w-full rounded-[10px] border border-white/15 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5 transition-colors"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
