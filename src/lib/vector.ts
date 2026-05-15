import { LOGOS_EMBEDDING_DIMENSIONS } from '@/lib/constants';

export const validateEmbedding = (embedding: number[], label = 'embedding'): void => {
  if (embedding.length !== LOGOS_EMBEDDING_DIMENSIONS) {
    throw new Error(`${label} must have ${LOGOS_EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}`);
  }

  if (!embedding.every(Number.isFinite)) {
    throw new Error(`${label} contains non-finite values`);
  }
};

export const l2Normalize = (embedding: number[], label = 'embedding'): number[] => {
  validateEmbedding(embedding, label);

  const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    throw new Error('embedding cannot be the zero vector');
  }

  return embedding.map((value) => value / norm);
};

export const toPgVector = (embedding: number[]): string => {
  validateEmbedding(embedding);
  return `[${embedding.join(',')}]`;
};

export const mockEmbedding = (text: string): number[] => {
  const values = Array.from({ length: LOGOS_EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    values[Math.abs(hash) % LOGOS_EMBEDDING_DIMENSIONS] += 1;
  }

  if (tokens.length === 0) values[0] = 1;
  return l2Normalize(values);
};
