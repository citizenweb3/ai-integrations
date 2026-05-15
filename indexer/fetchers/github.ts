export type GitHubRepository = {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  default_branch: string;
  pushed_at: string | null;
};

export type GitHubTreeItem = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
};

type GitHubTreeResponse = {
  tree: GitHubTreeItem[];
  truncated: boolean;
};

type GitHubRequestOptions = {
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const USER_AGENT = 'logos-chatbot-indexer/0.1 (+https://logos.co)';
const MAX_ATTEMPTS = 4;
const RETRY_TIMEOUT_PROGRESSION_MS = [15_000, 25_000, 40_000, 60_000];
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_JITTER_RATIO = 0.2;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const jitteredDelay = (baseMs: number): number => {
  const jitter = baseMs * RETRY_JITTER_RATIO;
  return Math.round(baseMs + (Math.random() * 2 - 1) * jitter);
};

const warnRetry = (event: string, fields: Record<string, unknown>): void => {
  console.warn(
    JSON.stringify({
      service: 'logos-chatbot-indexer',
      level: 'warn',
      event,
      ...fields,
    }),
  );
};

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

const token = () => process.env.GITHUB_API_TOKEN;

const headersFor = (accept = 'application/vnd.github+json'): Record<string, string> => ({
  accept,
  'user-agent': USER_AGENT,
  'x-github-api-version': '2022-11-28',
  ...(token() ? { authorization: `Bearer ${token()}` } : {}),
});

const encodeRepoPath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

const readResponseText = async (response: Response, maxBytes: number): Promise<string> => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`GitHub response too large: ${contentLength} bytes`);
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
      throw new Error(`GitHub response exceeded ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
};

const assertGitHubResponse = async (response: Response, url: string): Promise<void> => {
  if (response.ok) return;

  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  if (response.status === 403 && remaining === '0' && reset) {
    throw new NonRetryableError(
      `GitHub rate limit exhausted until ${new Date(Number(reset) * 1000).toISOString()}`,
    );
  }

  const body = await response.text().catch(() => '');
  const message = `GitHub API ${response.status} ${response.statusText} for ${url}${body ? `: ${body.slice(0, 300)}` : ''}`;

  const transient = response.status === 429 || response.status >= 500;
  if (transient) throw new Error(message);
  throw new NonRetryableError(message);
};

const attemptGitHubFetch = async (url: string, accept: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: headersFor(accept),
      redirect: 'manual',
      signal: controller.signal,
    });
    await assertGitHubResponse(response, url);
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const githubFetch = async (url: string, options: GitHubRequestOptions = {}): Promise<Response> => {
  const accept = options.accept ?? 'application/vnd.github+json';
  const baseTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const timeoutMs = options.timeoutMs ? baseTimeout : RETRY_TIMEOUT_PROGRESSION_MS[attempt] ?? baseTimeout;

    try {
      return await attemptGitHubFetch(url, accept, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error instanceof NonRetryableError) throw error;

      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (isLastAttempt) break;

      const delayMs = jitteredDelay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      warnRetry('github_fetch_retry', {
        url,
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        timeoutMs,
        nextDelayMs: delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const githubJson = async <T>(url: string): Promise<T> => {
  const response = await githubFetch(url);
  return response.json() as Promise<T>;
};

export const listOrganizationRepositories = async (
  org: string,
  options: {
    includeArchived: boolean;
    includeForks: boolean;
    maxRepos: number;
  },
): Promise<GitHubRepository[]> => {
  const repos: GitHubRepository[] = [];
  const perPage = 100;

  for (let page = 1; repos.length < options.maxRepos; page += 1) {
    const url = `${GITHUB_API_BASE}/orgs/${encodeURIComponent(org)}/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`;
    const pageRepos = await githubJson<GitHubRepository[]>(url);
    if (pageRepos.length === 0) break;

    repos.push(
      ...pageRepos.filter(
        (repo) =>
          !repo.disabled &&
          (options.includeArchived || !repo.archived) &&
          (options.includeForks || !repo.fork),
      ),
    );

    if (pageRepos.length < perPage) break;
  }

  return repos.slice(0, options.maxRepos);
};

export const getRepository = async (fullName: string): Promise<GitHubRepository> => {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error(`Invalid GitHub repo full name: ${fullName}`);
  return githubJson<GitHubRepository>(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  );
};

export const getRepositoryTree = async (repo: GitHubRepository): Promise<GitHubTreeItem[]> => {
  const [owner, name] = repo.full_name.split('/');
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`;

  try {
    const tree = await githubJson<GitHubTreeResponse>(url);
    if (tree.truncated) {
      throw new Error(`GitHub tree is truncated for ${repo.full_name}; refusing partial crawl`);
    }
    return tree.tree;
  } catch (error) {
    if (error instanceof Error && /Git Repository is empty/i.test(error.message)) {
      return [];
    }
    throw error;
  }
};

export const fetchRepositoryRawFile = async (
  repo: GitHubRepository,
  path: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<string> => {
  const [owner, name] = repo.full_name.split('/');
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(repo.default_branch)}`;
  const response = await githubFetch(url, {
    accept: 'application/vnd.github.v3.raw',
    maxBytes,
  });
  return readResponseText(response, maxBytes);
};
