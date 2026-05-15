import type { LogosChatMessage } from '@/components/chat/types';

import { textForMessage } from './messages';

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: LogosChatMessage[];
};

export type ChatHistorySnapshot = {
  activeSessionId: string;
  sessions: ChatSession[];
};

const CHAT_HISTORY_STORAGE_KEY = 'logos-chat-history-v1';
const ACTIVE_SESSION_STORAGE_KEY = 'logos-chat-active-session-id';
const CHAT_HISTORY_EVENT = 'logos-chat-history-change';
const PENDING_SESSION_ID = 'pending-session';
const MAX_CHAT_SESSIONS = 30;

const pendingSession: ChatSession = {
  id: PENDING_SESSION_ID,
  title: 'New chat',
  createdAt: '',
  updatedAt: '',
  messages: [],
};

const serverSnapshot: ChatHistorySnapshot = {
  activeSessionId: PENDING_SESSION_ID,
  sessions: [pendingSession],
};

let cachedSnapshot: ChatHistorySnapshot | null = null;

const isBrowser = (): boolean => typeof window !== 'undefined';

const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const nowIso = (): string => new Date().toISOString();

export const createEmptyChatSession = (id = createId()): ChatSession => {
  const createdAt = nowIso();

  return {
    id,
    title: 'New chat',
    createdAt,
    updatedAt: createdAt,
    messages: [],
  };
};

const isChatMessage = (value: unknown): value is LogosChatMessage => {
  if (!value || typeof value !== 'object') return false;

  const message = value as Partial<LogosChatMessage>;
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    Array.isArray(message.parts)
  );
};

const normalizeSession = (value: unknown): ChatSession | null => {
  if (!value || typeof value !== 'object') return null;

  const session = value as Partial<ChatSession>;
  if (typeof session.id !== 'string') return null;

  const createdAt = typeof session.createdAt === 'string' ? session.createdAt : nowIso();
  const updatedAt = typeof session.updatedAt === 'string' ? session.updatedAt : createdAt;
  const messages = Array.isArray(session.messages) ? session.messages.filter(isChatMessage) : [];

  return {
    id: session.id,
    title: typeof session.title === 'string' && session.title.trim() ? session.title : titleForMessages(messages),
    createdAt,
    updatedAt,
    messages,
  };
};

const sortSessions = (sessions: ChatSession[]): ChatSession[] => {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const titleForMessages = (messages: LogosChatMessage[]): string => {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) return 'New chat';

  const title = textForMessage(firstUserMessage).replace(/\s+/g, ' ').trim();
  if (!title) return 'New chat';
  return title.length > 56 ? `${title.slice(0, 53)}...` : title;
};

const normalizeSnapshot = (snapshot: ChatHistorySnapshot): ChatHistorySnapshot => {
  const sessions = sortSessions(snapshot.sessions).slice(0, MAX_CHAT_SESSIONS);
  const activeSessionId = sessions.some((session) => session.id === snapshot.activeSessionId)
    ? snapshot.activeSessionId
    : sessions[0]?.id;

  if (sessions.length === 0 || !activeSessionId) {
    const session = createEmptyChatSession();
    return {
      activeSessionId: session.id,
      sessions: [session],
    };
  }

  return {
    activeSessionId,
    sessions,
  };
};

const writeSnapshot = (snapshot: ChatHistorySnapshot): ChatHistorySnapshot => {
  const normalized = normalizeSnapshot(snapshot);
  cachedSnapshot = normalized;

  if (isBrowser()) {
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(normalized.sessions));
    window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, normalized.activeSessionId);
    window.dispatchEvent(new Event(CHAT_HISTORY_EVENT));
  }

  return normalized;
};

const readStoredSnapshot = (): ChatHistorySnapshot => {
  if (!isBrowser()) return serverSnapshot;

  const rawSessions = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
  const rawActiveSessionId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);

  if (!rawSessions) {
    return writeSnapshot({
      activeSessionId: '',
      sessions: [createEmptyChatSession()],
    });
  }

  try {
    const parsed = JSON.parse(rawSessions);
    const sessions = Array.isArray(parsed) ? parsed.map(normalizeSession).filter((session) => session !== null) : [];

    return normalizeSnapshot({
      activeSessionId: rawActiveSessionId ?? '',
      sessions,
    });
  } catch {
    return writeSnapshot({
      activeSessionId: '',
      sessions: [createEmptyChatSession()],
    });
  }
};

const updateSnapshot = (updater: (snapshot: ChatHistorySnapshot) => ChatHistorySnapshot): ChatHistorySnapshot => {
  return writeSnapshot(updater(getChatHistorySnapshot()));
};

export const getChatHistoryServerSnapshot = (): ChatHistorySnapshot => serverSnapshot;

export const getChatHistorySnapshot = (): ChatHistorySnapshot => {
  if (!isBrowser()) return serverSnapshot;
  cachedSnapshot ??= readStoredSnapshot();
  return cachedSnapshot;
};

export const subscribeToChatHistory = (onStoreChange: () => void): (() => void) => {
  if (!isBrowser()) return () => undefined;

  const handleChange = () => {
    cachedSnapshot = null;
    onStoreChange();
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CHAT_HISTORY_STORAGE_KEY || event.key === ACTIVE_SESSION_STORAGE_KEY) handleChange();
  };

  const hydrationTimer = window.setTimeout(handleChange, 0);
  window.addEventListener(CHAT_HISTORY_EVENT, handleChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.clearTimeout(hydrationTimer);
    window.removeEventListener(CHAT_HISTORY_EVENT, handleChange);
    window.removeEventListener('storage', handleStorage);
  };
};

export const getActiveChatSession = (snapshot: ChatHistorySnapshot): ChatSession => {
  return snapshot.sessions.find((session) => session.id === snapshot.activeSessionId) ?? snapshot.sessions[0] ?? pendingSession;
};

export const createChatSession = (): string => {
  const session = createEmptyChatSession();

  updateSnapshot((snapshot) => ({
    activeSessionId: session.id,
    sessions: [session, ...snapshot.sessions.filter((existing) => existing.id !== PENDING_SESSION_ID)],
  }));

  return session.id;
};

export const activateChatSession = (sessionId: string): void => {
  updateSnapshot((snapshot) => ({
    ...snapshot,
    activeSessionId: sessionId,
  }));
};

export const deleteChatSession = (sessionId: string): void => {
  updateSnapshot((snapshot) => {
    const sessions = snapshot.sessions.filter((session) => session.id !== sessionId);
    const nextSessions = sessions.length > 0 ? sessions : [createEmptyChatSession()];

    return {
      activeSessionId: snapshot.activeSessionId === sessionId ? nextSessions[0].id : snapshot.activeSessionId,
      sessions: nextSessions,
    };
  });
};

export const replaceChatSessionMessages = (sessionId: string, messages: LogosChatMessage[]): void => {
  if (sessionId === PENDING_SESSION_ID) return;

  updateSnapshot((snapshot) => {
    const updatedAt = nowIso();
    const existingSession = snapshot.sessions.find((session) => session.id === sessionId);
    const session = existingSession ?? createEmptyChatSession(sessionId);

    return {
      activeSessionId: sessionId,
      sessions: [
        {
          ...session,
          title: titleForMessages(messages),
          updatedAt,
          messages,
        },
        ...snapshot.sessions.filter((existing) => existing.id !== sessionId && existing.id !== PENDING_SESSION_ID),
      ],
    };
  });
};

export const clearChatSession = (sessionId: string): void => {
  replaceChatSessionMessages(sessionId, []);
};
