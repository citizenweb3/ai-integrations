const STORAGE_KEY = 'logos-chat-session-id';
const PENDING_SESSION_ID = 'pending-session';

export const getOrCreateSessionId = (): string => {
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const generated = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, generated);
  return generated;
};

export const getInitialSessionId = (): string => {
  if (typeof window === 'undefined') return PENDING_SESSION_ID;
  return getOrCreateSessionId();
};
