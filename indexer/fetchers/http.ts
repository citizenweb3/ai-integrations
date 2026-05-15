type FetchTextOptions = {
  url: string;
  allowedHosts: string[];
  timeoutMs?: number;
  maxBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 3_000_000;
const DEFAULT_ROBOTS_MAX_BYTES = 500_000;
const MAX_REDIRECTS = 5;
const BOT_USER_AGENT = 'logos-chatbot-indexer';
const USER_AGENT = 'logos-chatbot-indexer/0.1 (+https://logos.co)';
const robotsCache = new Map<string, Promise<string>>();

export const assertAllowedUrl = (url: string, allowedHosts: string[]): URL => {
  const parsed = new URL(url);
  const allowed = allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  if (!allowed) {
    throw new Error(`URL host is not allowlisted: ${parsed.hostname}`);
  }

  return parsed;
};

const fetchRobotsTxt = async (origin: string): Promise<string> => {
  const existing = robotsCache.get(origin);
  if (existing) return existing;

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${origin}/robots.txt`, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/plain,*/*;q=0.8',
        },
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status === 404 || response.status === 410) return '';
      if (!response.ok) {
        throw new Error(`robots.txt fetch failed for ${origin}: ${response.status} ${response.statusText}`);
      }

      return readResponseText(response, DEFAULT_ROBOTS_MAX_BYTES);
    } finally {
      clearTimeout(timeout);
    }
  })();

  promise.catch(() => {
    if (robotsCache.get(origin) === promise) {
      robotsCache.delete(origin);
    }
  });

  robotsCache.set(origin, promise);
  return promise;
};

const escapeRegExp = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

const robotsPatternMatches = (rulePath: string, path: string): boolean => {
  if (rulePath === '') return false;
  const anchored = rulePath.endsWith('$');
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const pattern = body.split('*').map(escapeRegExp).join('.*');
  const regex = new RegExp(`^${pattern}${anchored ? '$' : ''}`);
  return regex.test(path);
};

const parseRobotsGroups = (robotsTxt: string): { agents: string[]; rules: { type: 'allow' | 'disallow'; path: string }[] }[] => {
  const groups: { agents: string[]; rules: { type: 'allow' | 'disallow'; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { type: 'allow' | 'disallow'; path: string }[] } | null = null;

  for (const rawLine of robotsTxt.split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;

    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const key = field.trim().toLowerCase();

    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue;
    if (key === 'allow' && value) current.rules.push({ type: 'allow', path: value });
    if (key === 'disallow' && value) current.rules.push({ type: 'disallow', path: value });
  }

  return groups;
};

const userAgentSpecificity = (agent: string): number => {
  if (agent === '*') return 0;
  return BOT_USER_AGENT.startsWith(agent) ? agent.length : -1;
};

const isPathAllowedByRobots = (path: string, robotsTxt: string): boolean => {
  const matchingGroups = parseRobotsGroups(robotsTxt)
    .map((group) => ({
      group,
      specificity: Math.max(...group.agents.map(userAgentSpecificity)),
    }))
    .filter(({ specificity }) => specificity >= 0);

  const bestSpecificity = Math.max(-1, ...matchingGroups.map(({ specificity }) => specificity));
  if (bestSpecificity < 0) return true;

  const bestGroups = matchingGroups
    .filter(({ specificity }) => specificity === bestSpecificity)
    .map(({ group }) => group);
  const rules = bestGroups.flatMap((group) => group.rules).filter((rule) => robotsPatternMatches(rule.path, path));

  if (rules.length === 0) return true;
  rules.sort((a, b) => {
    const lengthDelta = b.path.length - a.path.length;
    if (lengthDelta !== 0) return lengthDelta;
    if (a.type === b.type) return 0;
    return a.type === 'allow' ? -1 : 1;
  });
  return rules[0].type === 'allow';
};

const assertRobotsAllowed = async (url: URL): Promise<void> => {
  const robotsTxt = await fetchRobotsTxt(url.origin);
  const path = `${url.pathname}${url.search}`;
  if (!isPathAllowedByRobots(path, robotsTxt)) {
    throw new Error(`Blocked by robots.txt: ${url.href}`);
  }
};

const fetchResponseWithRedirects = async (
  url: URL,
  allowedHosts: string[],
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: URL }> => {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    assertAllowedUrl(currentUrl.href, allowedHosts);
    await assertRobotsAllowed(currentUrl);

    const response = await fetch(currentUrl.href, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual',
      signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new Error(`Redirect without Location header: ${currentUrl.href}`);
      }
      currentUrl = assertAllowedUrl(new URL(location, currentUrl).href, allowedHosts);
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error(`Too many redirects for ${url.href}`);
};

const readResponseText = async (response: Response, maxBytes: number): Promise<string> => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response too large: ${contentLength} bytes`);
  }

  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Response exceeded ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
};

export const fetchTextWithMetadata = async ({
  url,
  allowedHosts,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
}: FetchTextOptions): Promise<{ text: string; finalUrl: string }> => {
  const parsed = assertAllowedUrl(url, allowedHosts);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { response, finalUrl } = await fetchResponseWithRedirects(parsed, allowedHosts, controller.signal);
    if (!response.ok) {
      throw new Error(`Fetch failed for ${finalUrl.href}: ${response.status} ${response.statusText}`);
    }

    return {
      text: await readResponseText(response, maxBytes),
      finalUrl: finalUrl.href,
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchText = async (options: FetchTextOptions): Promise<string> => {
  const { text } = await fetchTextWithMetadata(options);
  return text;
};

export const discoverRobotsSitemaps = async (url: string, allowedHosts: string[]): Promise<string[]> => {
  const parsed = assertAllowedUrl(url, allowedHosts);
  const robotsTxt = await fetchRobotsTxt(parsed.origin);

  return robotsTxt
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [field, ...rest] = line.split(':');
      if (field.trim().toLowerCase() !== 'sitemap') return null;
      const sitemapUrl = rest.join(':').trim();
      try {
        return assertAllowedUrl(sitemapUrl, allowedHosts).href;
      } catch {
        return null;
      }
    })
    .filter((sitemapUrl): sitemapUrl is string => Boolean(sitemapUrl));
};
