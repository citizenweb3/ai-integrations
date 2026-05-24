import { createHash } from 'crypto';

import Redis from 'ioredis';

const CACHE_VERSION = 'v1';
const REWRITE_TTL_SEC = 60 * 60 * 24 * 30;
const EMBED_TTL_SEC = 60 * 60 * 24 * 30;

let redisClient: Redis | null = null;

const getRedis = (): Redis | null => {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return null;

    redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    redisClient.on('error', (error) => {
      console.warn('[retrieval-cache] redis error', { message: error.message });
    });
  }

  return redisClient.status === 'ready' ? redisClient : null;
};

const normalize = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!.\s]+$/, '');

const hash = (text: string): string =>
  createHash('sha256').update(normalize(text)).digest('hex').slice(0, 16);

const rewriteKey = (query: string): string => `rag:rewrite:${CACHE_VERSION}:${hash(query)}`;

const embedKey = (text: string, model: string): string =>
  `rag:embed:${CACHE_VERSION}:${model}:${hash(text)}`;

const getRewrite = async (query: string): Promise<string | null> => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get(rewriteKey(query));
  } catch (error) {
    console.warn('[retrieval-cache] rewrite get failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const setRewrite = async (query: string, rewritten: string): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(rewriteKey(query), rewritten, 'EX', REWRITE_TTL_SEC);
  } catch (error) {
    console.warn('[retrieval-cache] rewrite set failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const getEmbedding = async (text: string, model: string): Promise<number[] | null> => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(embedKey(text, model));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'number')) return null;
    return parsed as number[];
  } catch (error) {
    console.warn('[retrieval-cache] embed get failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const setEmbedding = async (text: string, model: string, embedding: number[]): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(embedKey(text, model), JSON.stringify(embedding), 'EX', EMBED_TTL_SEC);
  } catch (error) {
    console.warn('[retrieval-cache] embed set failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const close = async (): Promise<void> => {
  if (!redisClient) return;
  await redisClient.quit();
  redisClient = null;
};

const retrievalCacheService = {
  getRewrite,
  setRewrite,
  getEmbedding,
  setEmbedding,
  close,
};

export default retrievalCacheService;
