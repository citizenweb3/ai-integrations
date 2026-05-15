import type { UIMessage } from 'ai';

const PAIR_WEIGHTS = [1.0, 0.75, 0.5, 0.25];

const extractTextFromMessage = (message: UIMessage): string => {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
    .trim();
};

const truncate = (text: string, weight: number): string => {
  if (weight <= 0 || !text) return '';
  if (weight >= 1) return text;
  const limit = Math.max(1, Math.floor(text.length * weight));
  if (limit >= text.length) return text;
  return `${text.slice(0, limit).trim()}...`;
};

export const buildWeightedHistory = (messages: UIMessage[]): string | null => {
  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  })();

  if (lastUserIndex <= 0) return null;

  const prior = messages.slice(0, lastUserIndex);
  if (prior.length === 0) return null;

  const lines: string[] = [];
  let weightIndex = 0;

  for (let i = prior.length - 1; i >= 0; i -= 1) {
    if (weightIndex >= PAIR_WEIGHTS.length) break;

    const message = prior[i];
    if (message.role !== 'assistant' && message.role !== 'user') continue;

    const weight = PAIR_WEIGHTS[weightIndex];
    const text = truncate(extractTextFromMessage(message), weight);
    if (!text) continue;

    const role = message.role === 'assistant' ? 'Assistant' : 'User';
    lines.unshift(`${role}: ${text}`);

    if (message.role === 'user') weightIndex += 1;
  }

  if (lines.length === 0) return null;
  return lines.join('\n');
};
