import { textForMessage } from '@/lib/chat/messages';
import type { ChatSession } from '@/lib/chat/history';

type ChatHistorySidebarProps = {
  activeSessionId: string;
  isBusy: boolean;
  sessions: ChatSession[];
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
};

const previewForSession = (session: ChatSession): string => {
  const lastMessage = [...session.messages].reverse().find((message) => textForMessage(message));
  if (!lastMessage) return 'No messages yet';

  const preview = textForMessage(lastMessage).replace(/\s+/g, ' ').trim();
  return preview.length > 84 ? `${preview.slice(0, 81)}...` : preview;
};

const dateForSession = (session: ChatSession): string => {
  if (!session.updatedAt) return '';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(session.updatedAt));
};

const ChatHistorySidebar = ({
  activeSessionId,
  isBusy,
  sessions,
  onCreateSession,
  onDeleteSession,
  onSelectSession,
}: ChatHistorySidebarProps) => {
  return (
    <aside className="flex min-h-0 flex-col border-b border-white/10 bg-[#0d0d0e] lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">History</h2>
          <p className="mt-1 text-xs text-white/38">Saved in this browser</p>
        </div>
        <button
          type="button"
          onClick={onCreateSession}
          disabled={isBusy}
          className="rounded-[8px] border border-white/15 px-3 py-2 text-sm font-medium text-white/80 transition hover:border-[#2FFBF7]/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          New
        </button>
      </div>

      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto p-3 lg:max-h-none lg:flex-1">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;

          return (
            <div
              key={session.id}
              className={
                isActive
                  ? 'group rounded-[8px] border border-[#2FFBF7]/35 bg-[#2FFBF7]/10 p-3 transition'
                  : 'group rounded-[8px] border border-transparent bg-white/[0.03] p-3 transition hover:border-white/12 hover:bg-white/[0.06]'
              }
            >
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                disabled={isBusy}
                className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{session.title}</span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-white/42">
                      {previewForSession(session)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-white/35">
                    {dateForSession(session)}
                  </span>
                </span>
              </button>

              {sessions.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeleteSession(session.id)}
                  disabled={isBusy}
                  className="mt-3 text-xs text-white/35 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};

export default ChatHistorySidebar;
