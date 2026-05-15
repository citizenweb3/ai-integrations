import type { UIMessage } from 'ai';

export type ChatSource = {
  id: number;
  citationId: number;
  title: string;
  url: string;
  sourceType: string;
  snippet: string;
};

export type ChatMessageMetadata = {
  sources?: ChatSource[];
};

export type LogosChatMessage = UIMessage<ChatMessageMetadata>;

