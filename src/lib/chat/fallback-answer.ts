import type { RerankedChunk } from '@/app/services/rerank-service';

const MAX_SUPPORTING_POINTS = 3;
const MAX_SENTENCE_LENGTH = 240;

const cleanText = (text: string): string => {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\[[^\]]*]/g, '')
    .trim();
};

const sentenceCandidates = (text: string): string[] => {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40)
    .map((sentence) => (sentence.length > MAX_SENTENCE_LENGTH ? `${sentence.slice(0, MAX_SENTENCE_LENGTH).trim()}...` : sentence));
};

const bestSentenceForChunk = (chunk: RerankedChunk): string => {
  const text = [chunk.contextPrefix, chunk.content].filter(Boolean).join(' ');
  return sentenceCandidates(text)[0] ?? cleanText(chunk.content).slice(0, MAX_SENTENCE_LENGTH);
};

const sourceLabel = (chunk: RerankedChunk, index: number): string => {
  return `${chunk.sourceTitle} [${index + 1}]`;
};

export const fallbackAnswer = (query: string, chunks: RerankedChunk[]): string => {
  if (chunks.length === 0) {
    return [
      "I don't have Logos docs covering this yet.",
      '',
      'Try asking a narrower Logos question, or check https://forum.logos.co and https://discord.gg/logosnetwork.',
    ].join('\n');
  }

  const topChunks = chunks.slice(0, MAX_SUPPORTING_POINTS);
  const supportingPoints = topChunks.map((chunk, index) => {
    return `- ${bestSentenceForChunk(chunk)} [${index + 1}]`;
  });
  const nextSteps = topChunks.map((chunk, index) => {
    return `${index + 1}. Read ${sourceLabel(chunk, index)} for the underlying source material.`;
  });

  return [
    `Short answer: I found Logos source material that can help answer "${query}". The strongest match is ${sourceLabel(topChunks[0], 0)}.`,
    '',
    'What the indexed material says:',
    supportingPoints.join('\n'),
    '',
    'How to use this:',
    nextSteps.join('\n'),
    '',
    'This is a source-grounded fallback answer. With Vertex AI credentials configured, I can synthesize the same retrieved context into a more natural conversational explanation.',
  ].join('\n');
};
