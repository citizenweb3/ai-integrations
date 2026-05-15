'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  activateChatSession,
  clearChatSession,
  createChatSession,
  deleteChatSession,
  getActiveChatSession,
  getChatHistoryServerSnapshot,
  getChatHistorySnapshot,
  replaceChatSessionMessages,
  subscribeToChatHistory,
} from '@/lib/chat/history';
import {
  getStarterQuestionsServerSnapshot,
  getStarterQuestionsSnapshot,
  subscribeToStarterQuestions,
} from '@/lib/chat/starter-questions';

import ChatComposer from './chat-composer';
import ChatHistorySidebar from './chat-history-sidebar';
import MessageBubble from './message-bubble';
import StarterQuestions from './starter-questions';
import type { LogosChatMessage } from './types';
import WelcomeMessage from './welcome-message';

const LogosChat = () => {
  const [input, setInput] = useState('');
  const chatHistory = useSyncExternalStore(
    subscribeToChatHistory,
    getChatHistorySnapshot,
    getChatHistoryServerSnapshot,
  );
  const starterQuestions = useSyncExternalStore(
    subscribeToStarterQuestions,
    getStarterQuestionsSnapshot,
    getStarterQuestionsServerSnapshot,
  );
  const activeSession = getActiveChatSession(chatHistory);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<LogosChatMessage>({
        api: '/api/chat',
        body: { sessionId: activeSession.id },
      }),
    [activeSession.id],
  );

  const { messages, sendMessage, setMessages, stop, status, error } = useChat<LogosChatMessage>({
    id: activeSession.id,
    messages: activeSession.messages,
    transport,
    onFinish: ({ messages: finishedMessages }) => {
      replaceChatSessionMessages(activeSession.id, finishedMessages);
    },
  });

  const isBusy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (isBusy) return;
    replaceChatSessionMessages(activeSession.id, messages);
  }, [activeSession.id, isBusy, messages]);

  const submitText = (text: string) => {
    const value = text.trim();
    if (!value || isBusy) return;

    setInput('');
    void sendMessage({ text: value });
  };

  const handleCreateSession = () => {
    if (isBusy) return;
    setInput('');
    createChatSession();
  };

  const handleSelectSession = (sessionId: string) => {
    if (isBusy || sessionId === activeSession.id) return;
    setInput('');
    activateChatSession(sessionId);
  };

  const handleDeleteSession = (sessionId: string) => {
    if (isBusy) return;
    deleteChatSession(sessionId);
  };

  const handleClearSession = () => {
    if (isBusy) return;
    setInput('');
    setMessages([]);
    clearChatSession(activeSession.id);
  };

  return (
    <section className="grid min-h-0 flex-1 overflow-hidden rounded-[10px] border border-white/10 bg-[#080808]/92 shadow-[0_36px_110px_rgba(0,0,0,0.68)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <ChatHistorySidebar
        activeSessionId={activeSession.id}
        isBusy={isBusy}
        sessions={chatHistory.sessions}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onSelectSession={handleSelectSession}
      />

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex min-h-14 items-center justify-end border-b border-white/10 px-5 py-3">
          <div className="flex gap-2">
            {isBusy && (
              <button
                type="button"
                onClick={stop}
                className="rounded-[8px] border border-white/15 px-3 py-2 text-sm text-white/75 transition hover:border-white/35 hover:text-white"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={handleClearSession}
              disabled={isBusy || messages.length === 0}
              className="rounded-[8px] border border-white/15 px-3 py-2 text-sm text-white/75 transition hover:border-white/35 hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-6 md:px-8">
          {messages.length === 0 ? (
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center">
              <WelcomeMessage />
              <StarterQuestions questions={starterQuestions} isBusy={isBusy} onSelect={submitText} />
            </div>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
          {status === 'submitted' && <div className="text-sm text-white/45">Retrieving Logos context...</div>}
          {error && (
            <div className="rounded-[10px] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error.message}
            </div>
          )}
        </div>

        <ChatComposer input={input} isBusy={isBusy} onInputChange={setInput} onSubmitText={submitText} />
      </div>
    </section>
  );
};

export default LogosChat;
