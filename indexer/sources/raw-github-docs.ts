import type { FetchedDocument } from '../types';

export type RawGitHubDocumentConfig = {
  id: string;
  title: string;
  repo: string;
  branch: string;
  path: string;
  sourceType: string;
};

const RAW_GITHUB_HOST = 'raw.githubusercontent.com';
const MIN_WORDS = 20;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RAW_BYTES = 1_000_000;

const normalizeMarkdownContent = (text: string): string => {
  return text
    .replace(/^---\s*[\s\S]*?\s*---\s*/u, '')
    .replace(/\[!\[[^\]]*]\([^)]*\)]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const wordsIn = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

const rawUrlFor = (document: RawGitHubDocumentConfig): string => {
  const encodedPath = document.path.split('/').map(encodeURIComponent).join('/');
  return `https://${RAW_GITHUB_HOST}/${document.repo}/${encodeURIComponent(document.branch)}/${encodedPath}`;
};

const githubUrlFor = (document: RawGitHubDocumentConfig): string => {
  const encodedPath = document.path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${document.repo}/blob/${encodeURIComponent(document.branch)}/${encodedPath}`;
};

const readResponseText = async (response: Response): Promise<string> => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RAW_BYTES) {
    throw new Error(`Raw GitHub document is too large: ${contentLength} bytes`);
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RAW_BYTES) {
    throw new Error(`Raw GitHub document exceeded ${MAX_RAW_BYTES} bytes`);
  }

  return text;
};

const fetchRawMarkdown = async (url: string): Promise<string> => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== RAW_GITHUB_HOST) {
    throw new Error(`Raw GitHub URL is not allowlisted: ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'logos-chatbot-indexer/0.1 (+https://logos.co)',
        accept: 'text/plain,*/*;q=0.8',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
    }

    return readResponseText(response);
  } finally {
    clearTimeout(timeout);
  }
};

const identifierFor = (document: RawGitHubDocumentConfig): string => {
  return `github-raw:${document.repo}:${document.branch}:${document.path}`;
};

export const fetchRawGitHubDocs = async (documents: RawGitHubDocumentConfig[]): Promise<FetchedDocument[]> => {
  const fetchedDocuments: FetchedDocument[] = [];
  let failed = 0;

  for (const document of documents) {
    try {
      const text = await fetchRawMarkdown(rawUrlFor(document));
      const content = normalizeMarkdownContent(text);

      if (wordsIn(content) < MIN_WORDS) {
        throw new Error(`Raw GitHub document is too short: ${document.repo}/${document.path}`);
      }

      fetchedDocuments.push({
        identifier: identifierFor(document),
        sourceType: document.sourceType,
        title: document.title,
        url: githubUrlFor(document),
        content,
        sectionPath: `${document.repo}/${document.path}`,
        language: 'en',
        metadata: {
          sourceId: 'raw-github-docs',
          repo: document.repo,
          branch: document.branch,
          path: document.path,
        },
      });
    } catch (error) {
      failed += 1;
      console.warn(
        JSON.stringify({
          service: 'logos-chatbot-indexer',
          level: 'warn',
          event: 'raw_github_doc_fetch_failed',
          repo: document.repo,
          path: document.path,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (failed > 0 && fetchedDocuments.length === 0) {
    throw new Error(`${failed} of ${documents.length} raw GitHub documents failed`);
  }

  return fetchedDocuments;
};
