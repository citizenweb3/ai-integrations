import type { LogosChatMessage } from '@/components/chat/types';

const ansiControlPattern = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const invisibleControlPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const cleanMessageText = (text: string): string => {
  return text.replace(ansiControlPattern, '').replace(invisibleControlPattern, '');
};

export const textForMessage = (message: LogosChatMessage): string => {
  return cleanMessageText(
    message.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(''),
  ).trim();
};
