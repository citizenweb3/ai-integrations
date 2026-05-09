const starterQuestions = [
  'How do I run a Logos node?',
  'What is Cryptarchia consensus?',
  'How does the Logos Execution Zone work?',
  'How is Waku used in Logos?',
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)]">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between border-b border-[var(--panel-border)] pb-5">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Logos</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">Onboarding Chatbot</h1>
          </div>
          <div className="rounded border border-[var(--panel-border)] px-3 py-2 text-sm text-[var(--muted)]">
            Docker scaffold ready
          </div>
        </header>

        <div className="grid flex-1 gap-6 py-8 lg:grid-cols-[1fr_320px]">
          <section className="flex min-h-[520px] flex-col rounded border border-[var(--panel-border)] bg-[var(--panel)]">
            <div className="border-b border-[var(--panel-border)] px-5 py-4">
              <h2 className="text-lg font-semibold">Chat</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                The streaming RAG endpoint will replace this placeholder in a later ticket.
              </p>
            </div>
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[var(--muted)]">
              Ask about Logos nodes, architecture, Waku messaging, LEZ, governance, and docs.
            </div>
            <div className="border-t border-[var(--panel-border)] p-4">
              <div className="h-12 rounded border border-[var(--panel-border)] bg-[#0b1017] px-4 py-3 text-sm text-[var(--muted)]">
                Composer placeholder
              </div>
            </div>
          </section>

          <aside className="rounded border border-[var(--panel-border)] bg-[var(--panel)] p-5">
            <h2 className="text-base font-semibold">Starter Questions</h2>
            <div className="mt-4 flex flex-col gap-3">
              {starterQuestions.map((question) => (
                <div
                  key={question}
                  className="rounded border border-[var(--panel-border)] px-3 py-3 text-sm text-[var(--foreground)]"
                >
                  {question}
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
