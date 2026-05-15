import {
  fetchRepositoryRawFile,
  getRepository,
  getRepositoryTree,
  listOrganizationRepositories,
  type GitHubRepository,
  type GitHubTreeItem,
} from '../fetchers/github';
import type { FetchedDocument } from '../types';

export type GitHubSourceConfig = {
  id: string;
  title: string;
  org: string;
  includeArchived: boolean;
  includeForks: boolean;
  maxRepos: number;
  maxFilesPerRepo: number;
  maxFileBytes: number;
  repoAllowlist: string[];
};

const skippedPathPattern =
  /(^|\/)(?:\.git|\.github|\.next|coverage|dist|build|node_modules|target|vendor|yarn\.cache)(\/|$)/i;

const markdownPathPattern = /\.(?:md|mdx)$/i;

const warn = (event: string, fields: Record<string, unknown>) => {
  console.warn(
    JSON.stringify({
      service: 'logos-chatbot-indexer',
      level: 'warn',
      event,
      ...fields,
    }),
  );
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

const wordsIn = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

const normalizedRepoAllowlist = (repos: string[]): string[] => {
  return unique(repos.map((repo) => repo.trim().toLowerCase()).filter(Boolean));
};

const repoBelongsToOrg = (repo: string, org: string): boolean => {
  return repo.toLowerCase().startsWith(`${org.toLowerCase()}/`);
};

const isMarkdownPath = (item: GitHubTreeItem): boolean => {
  if (item.type !== 'blob') return false;
  if (!markdownPathPattern.test(item.path)) return false;
  if (skippedPathPattern.test(item.path)) return false;
  return true;
};

const pathPriority = (repo: GitHubRepository, path: string): number => {
  const lowerPath = path.toLowerCase();
  const repoName = repo.name.toLowerCase();

  if (/^readme(?:\.[a-z]+)?\.mdx?$/i.test(path)) return 0;
  if (lowerPath.startsWith('docs/')) return 10;
  if (repoName.includes('lips') || lowerPath.includes('/lip-') || lowerPath.startsWith('lips/')) return 20;
  if (repoName.includes('spec') || lowerPath.includes('/spec') || lowerPath.startsWith('spec')) return 30;
  if (!lowerPath.includes('/')) return 40;
  return 50;
};

const markdownFilesForRepo = (
  repo: GitHubRepository,
  tree: GitHubTreeItem[],
  maxFiles: number,
  maxFileBytes: number,
): GitHubTreeItem[] => {
  return tree
    .filter(isMarkdownPath)
    .filter((item) => item.size === undefined || item.size <= maxFileBytes)
    .sort((left, right) => {
      const leftPriority = pathPriority(repo, left.path);
      const rightPriority = pathPriority(repo, right.path);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.path.localeCompare(right.path);
    })
    .slice(0, maxFiles);
};

const normalizeMarkdownContent = (text: string): string => {
  return text
    .replace(/^---\s*[\s\S]*?\s*---\s*/u, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const titleFor = (repo: GitHubRepository, path: string, content: string): string => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  if (/^readme(?:\.[a-z]+)?\.mdx?$/i.test(path)) return `${repo.full_name} README`;
  return `${repo.full_name}: ${path}`;
};

const sourceTypeFor = (repo: GitHubRepository, path: string): string => {
  const lowerPath = path.toLowerCase();
  const repoName = repo.name.toLowerCase();

  if (/^readme(?:\.[a-z]+)?\.mdx?$/i.test(path)) return 'github_readme';
  if (repoName.includes('lips') || lowerPath.includes('/lip-') || lowerPath.startsWith('lips/')) return 'lip';
  if (repoName.includes('spec') || lowerPath.includes('/spec') || lowerPath.startsWith('spec')) return 'spec';
  return 'github_markdown';
};

const identifierFor = (repo: GitHubRepository, path: string): string => `github:${repo.full_name}:${path}`;

const githubHtmlUrl = (repo: GitHubRepository, path: string): string => {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${repo.html_url}/blob/${encodeURIComponent(repo.default_branch)}/${encodedPath}`;
};

const fetchRepos = async (config: GitHubSourceConfig): Promise<GitHubRepository[]> => {
  const configuredAllowlist = normalizedRepoAllowlist(config.repoAllowlist);
  const allowlist = configuredAllowlist.filter((repo) => repoBelongsToOrg(repo, config.org));

  if (configuredAllowlist.length > 0 && allowlist.length === 0) return [];

  if (allowlist.length > 0) {
    const repos = await Promise.all(allowlist.map((repo) => getRepository(repo)));
    return repos
      .filter(
        (repo) =>
          !repo.disabled &&
          (config.includeArchived || !repo.archived) &&
          (config.includeForks || !repo.fork),
      )
      .slice(0, config.maxRepos);
  }

  return listOrganizationRepositories(config.org, {
    includeArchived: config.includeArchived,
    includeForks: config.includeForks,
    maxRepos: config.maxRepos,
  });
};

const fetchRepoDocs = async (repo: GitHubRepository, config: GitHubSourceConfig): Promise<FetchedDocument[]> => {
  const tree = await getRepositoryTree(repo);
  const markdownFiles = markdownFilesForRepo(repo, tree, config.maxFilesPerRepo, config.maxFileBytes);
  const documents: FetchedDocument[] = [];

  for (const item of markdownFiles) {
    const rawContent = await fetchRepositoryRawFile(repo, item.path, config.maxFileBytes);
    const content = normalizeMarkdownContent(rawContent);
    if (content.length < 120 || wordsIn(content) < 20) continue;

    documents.push({
      identifier: identifierFor(repo, item.path),
      sourceType: sourceTypeFor(repo, item.path),
      title: titleFor(repo, item.path, content),
      url: githubHtmlUrl(repo, item.path),
      content,
      sectionPath: `${repo.full_name}/${item.path}`,
      remoteRevision: item.sha,
      language: 'en',
      metadata: {
        sourceId: config.id,
        org: config.org,
        repo: repo.full_name,
        path: item.path,
        defaultBranch: repo.default_branch,
        repoDescription: repo.description,
        pushedAt: repo.pushed_at,
      },
    });
  }

  return documents;
};

export const fetchGitHubDocs = async (config: GitHubSourceConfig): Promise<FetchedDocument[]> => {
  const repos = await fetchRepos(config);
  const documents: FetchedDocument[] = [];
  let failedRepos = 0;

  for (const repo of repos) {
    try {
      documents.push(...(await fetchRepoDocs(repo, config)));
    } catch (error) {
      failedRepos += 1;
      warn('github_repo_fetch_failed', {
        sourceId: config.id,
        repo: repo.full_name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failedRepos > 0 && documents.length === 0) {
    throw new Error(`${failedRepos} of ${repos.length} GitHub repos failed for ${config.id}`);
  }

  if (failedRepos > 0) {
    warn('github_source_partial_fetch', {
      sourceId: config.id,
      failedRepos,
      fetchedRepos: repos.length - failedRepos,
    });
  }

  return documents;
};
