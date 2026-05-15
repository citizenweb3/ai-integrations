import { createHash } from 'crypto';

const dailySalt = (): string => new Date().toISOString().slice(0, 10);

export const hashIp = (ip: string): string => {
  const salt = process.env.IP_HASH_SALT || 'development-only-ip-salt';
  return createHash('sha256').update(`${salt}:${dailySalt()}:${ip}`).digest('hex');
};

export const sanitizeUserText = (text: string): string => {
  return text
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, ' ')
    .replace(/\bignore (?:all )?(?:previous|above|earlier) instructions\b/gi, ' ')
    .replace(/\breveal (?:the )?(?:system prompt|instructions)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
