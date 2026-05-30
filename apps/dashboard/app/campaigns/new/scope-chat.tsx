"use client";

import { useEffect, useRef, useState } from "react";
import { textareaClass } from "@/components/ui";
import ScopePreview from "./scope-preview";

// Client-side multi-turn campaign-scope assistant. Each turn posts the full
// chat history (state lives only here) to /api/campaign-assistant; the agent
// either asks one follow-up question or returns a ready AssistTurn that the
// preview card (T5) will render.

type ChatRole = "user" | "assistant";
type Message = { role: ChatRole; content: string };

type InferredFlag = { field: string; reason: string };

export type ScopeDraft = {
  name: string;
  objective: string;
  offerSummary: string;
  desiredCta: string;
  targetSegments: string[];
  forbiddenClaims: string[];
  operatorNotes: string;
  discoverySourceHints: string[];
  discoveryExclusions: string[];
  allowedRegions: string[];
  maxOrganizationsToDiscover: number;
  cooldownBetweenDiscoverySeconds: number;
};

export type AssistTurn =
  | { type: "question"; question: string; scope: null; inferred: InferredFlag[] }
  | { type: "ready"; question: null; scope: ScopeDraft; inferred: InferredFlag[] };

const INITIAL_ASSISTANT_MESSAGE =
  "Hi — let's build a campaign. To start, what's the goal of this outreach campaign? Try to be specific about who you want to reach and what you want them to do.";

const INITIAL_MESSAGES: Message[] = [
  { role: "assistant", content: INITIAL_ASSISTANT_MESSAGE },
];

export default function ScopeChat() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalTurn, setFinalTurn] = useState<AssistTurn | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, finalTurn]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaign-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as
        | AssistTurn
        | { error: string; detail?: string };
      if (!res.ok) {
        const err = data as { error: string; detail?: string };
        setError(err.detail ? `${err.error}: ${err.detail}` : err.error);
        return;
      }
      const turn = data as AssistTurn;
      if (turn.type === "ready") {
        setFinalTurn(turn);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: turn.question },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages(INITIAL_MESSAGES);
    setInput("");
    setBusy(false);
    setError(null);
    setFinalTurn(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-light opacity-60 leading-snug max-w-2xl">
          Tell the assistant what you want to do. It will ask one short
          question at a time, then propose a campaign scope you can review
          before creating.
        </p>
        <button
          type="button"
          onClick={reset}
          className="text-xs uppercase tracking-[0.18em] opacity-50 hover:opacity-90 transition-opacity"
        >
          Start over
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-col gap-3 h-[420px] overflow-y-auto rounded-xl border border-white/10 bg-[#0F0F10] p-4"
      >
        {messages.map((msg, idx) => (
          <ChatBubble key={idx} role={msg.role} content={msg.content} />
        ))}
        {busy ? <ChatBubble role="assistant" content="…" muted /> : null}
      </div>

      {finalTurn && finalTurn.type === "ready" ? (
        <ScopePreview
          turn={finalTurn}
          onBackToChat={() => {
            setFinalTurn(null);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  "What would you like to adjust? Tell me which field to change and what the new value should be.",
              },
            ]);
          }}
        />
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          <strong className="font-semibold">Assistant failed.</strong>{" "}
          <span className="font-light opacity-90">{error}</span>
        </div>
      ) : null}

      {finalTurn ? null : (
        <div className="flex flex-col gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Type your answer — Cmd/Ctrl+Enter sends."
            disabled={busy}
            rows={3}
            className={textareaClass}
          />
          <div className="flex items-center justify-end gap-3">
            <span className="text-[11px] opacity-40">
              {messages.filter((m) => m.role === "user").length} replies so far
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="rounded-lg font-bold tracking-wide px-3 py-1.5 text-xs bg-[var(--accent)] text-black hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "Thinking…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatBubble({
  role,
  content,
  muted = false,
}: {
  role: ChatRole;
  content: string;
  muted?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-[var(--accent)]/15 border border-[var(--accent)]/30"
            : "bg-white/5 border border-white/10"
        } ${muted ? "opacity-50" : ""}`}
      >
        {content}
      </div>
    </div>
  );
}

