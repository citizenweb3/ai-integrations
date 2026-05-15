import { createHash, randomBytes } from 'crypto';
import { isIP } from 'node:net';

import type { NextRequest } from 'next/server';

const ipHashSalt = randomBytes(32).toString('hex');

const dailySalt = (): string => new Date().toISOString().slice(0, 10);

export const hashIp = (ip: string): string => {
  return createHash('sha256').update(`${ipHashSalt}:${dailySalt()}:${ip}`).digest('hex');
};

const LOCAL_HOSTS = new Set(['0.0.0.0', '127.0.0.1', '::', '::1', 'localhost']);

const normalizeAddress = (value: string | null | undefined): string | null => {
  if (!value) return null;

  let candidate = value.trim().replace(/^for=/i, '').replace(/^"|"$/g, '');
  if (!candidate || candidate.toLowerCase() === 'unknown') return null;

  if (candidate.startsWith('[')) {
    const closing = candidate.indexOf(']');
    if (closing !== -1) {
      candidate = candidate.slice(1, closing);
    }
  }

  if (candidate.startsWith('::ffff:')) {
    candidate = candidate.slice('::ffff:'.length);
  }

  const ipv4WithPort = candidate.match(/^(.+):(\d+)$/);
  if (ipv4WithPort && isIP(ipv4WithPort[1]) === 4) {
    candidate = ipv4WithPort[1];
  }

  return candidate.toLowerCase();
};

const isPrivateIpv4 = (ip: string): boolean => {
  const octets = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const isPrivateIpv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized);
};

const isLocalAddress = (value: string): boolean => {
  const normalized = normalizeAddress(value);
  if (!normalized) return false;
  if (LOCAL_HOSTS.has(normalized)) return true;

  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) return isPrivateIpv6(normalized);

  return false;
};

const requestIp = (request: NextRequest): string | null => {
  const candidate = Reflect.get(request, 'ip');
  return typeof candidate === 'string' ? normalizeAddress(candidate) : null;
};

export const requestAddress = (request: NextRequest): string => {
  return requestIp(request) ?? normalizeAddress(request.nextUrl.hostname) ?? 'unknown';
};

export const isLocalRequest = (request: NextRequest): boolean => {
  const ip = requestIp(request);
  if (ip) return isLocalAddress(ip);

  return isLocalAddress(request.nextUrl.hostname);
};

export const sanitizeUserText = (text: string): string => {
  return text
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, ' ')
    .replace(/\bignore (?:all )?(?:previous|above|earlier) instructions\b/gi, ' ')
    .replace(/\breveal (?:the )?(?:system prompt|instructions)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
