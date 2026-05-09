import Redis from 'ioredis';

type RateLimitOptions = {
  max: number;
  windowSec: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetSec: number;
};

let redisClient: Redis | null = null;

const getRedis = (): Redis => {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('REDIS_URL is required');
    redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  }

  return redisClient;
};

const check = async (key: string, options: RateLimitOptions): Promise<RateLimitResult> => {
  const redis = getRedis();
  const redisKey = `rate-limit:${key}`;
  const count = await redis.incr(redisKey);

  if (count === 1) {
    await redis.expire(redisKey, options.windowSec);
  }

  const ttl = await redis.ttl(redisKey);
  const remaining = Math.max(options.max - count, 0);

  return {
    allowed: count <= options.max,
    remaining,
    resetSec: ttl > 0 ? ttl : options.windowSec,
  };
};

const close = async (): Promise<void> => {
  if (!redisClient) return;
  await redisClient.quit();
  redisClient = null;
};

const rateLimitService = {
  check,
  close,
};

export default rateLimitService;
