import { fetchStaticDocs } from './sources/static-docs';
import { fetchGitHubDocs, type GitHubSourceConfig } from './sources/github-docs';
import { fetchRawGitHubDocs, type RawGitHubDocumentConfig } from './sources/raw-github-docs';
import { fetchWebDocs, type WebSourceConfig } from './sources/web-docs';
import type { IndexerSource } from './types';

const envFlag = (name: string, defaultValue: boolean): boolean => {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return value === '1' || value.toLowerCase() === 'true';
};

const envNumber = (name: string, defaultValue: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
};

const envCsv = (name: string): string[] => {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

const webMaxPages = envNumber('INDEXER_WEB_MAX_PAGES_PER_SOURCE', 30);
const webCron = process.env.INDEXER_WEB_CRON ?? '23 4 * * *';
const githubCron = process.env.INDEXER_GITHUB_CRON ?? '41 3 * * *';
const githubMaxRepos = envNumber('INDEXER_GITHUB_MAX_REPOS_PER_ORG', 120);
const githubMaxFilesPerRepo = envNumber('INDEXER_GITHUB_MAX_FILES_PER_REPO', 60);
const githubMaxFileBytes = envNumber('INDEXER_GITHUB_MAX_FILE_BYTES', 1_000_000);
const githubRepoAllowlist = envCsv('INDEXER_GITHUB_REPO_ALLOWLIST');
const rawGitHubCron = process.env.INDEXER_RAW_GITHUB_CRON ?? '37 3 * * *';

const webSources: WebSourceConfig[] = [
  {
    id: 'logos-co',
    title: 'Logos website',
    sourceType: 'html',
    baseUrl: 'https://logos.co',
    sitemapUrls: ['https://logos.co/sitemap.xml'],
    fallbackUrls: ['https://logos.co'],
    allowedHosts: ['logos.co'],
    maxPages: webMaxPages,
  },
  {
    id: 'build-logos-co',
    title: 'Logos Builder Hub',
    sourceType: 'html',
    baseUrl: 'https://build.logos.co',
    sitemapUrls: [],
    fallbackUrls: ['https://build.logos.co'],
    allowedHosts: ['build.logos.co'],
    maxPages: webMaxPages,
  },
  {
    id: 'docs-waku-org',
    title: 'Waku documentation',
    sourceType: 'docs_site',
    baseUrl: 'https://docs.waku.org',
    sitemapUrls: ['https://docs.waku.org/sitemap.xml'],
    fallbackUrls: ['https://docs.waku.org'],
    allowedHosts: ['docs.waku.org'],
    maxPages: webMaxPages,
  },
  {
    id: 'press-logos-co',
    title: 'Logos Press Engine',
    sourceType: 'docs_site',
    baseUrl: 'https://press.logos.co',
    sitemapUrls: ['https://press.logos.co/sitemap.xml'],
    fallbackUrls: ['https://press.logos.co'],
    allowedHosts: ['press.logos.co'],
    maxPages: webMaxPages,
  },
  {
    id: 'blog-nomos-tech',
    title: 'Nomos technical blog',
    sourceType: 'docs_site',
    baseUrl: 'https://blog.nomos.tech',
    sitemapUrls: ['https://blog.nomos.tech/sitemap.xml'],
    fallbackUrls: ['https://blog.nomos.tech'],
    allowedHosts: ['blog.nomos.tech'],
    maxPages: webMaxPages,
  },
];

const githubSources: GitHubSourceConfig[] = [
  {
    id: 'github-logos-co',
    title: 'Logos GitHub organization',
    org: 'logos-co',
    includeArchived: false,
    includeForks: false,
    maxRepos: githubMaxRepos,
    maxFilesPerRepo: githubMaxFilesPerRepo,
    maxFileBytes: githubMaxFileBytes,
    repoAllowlist: githubRepoAllowlist,
  },
  {
    id: 'github-logos-blockchain',
    title: 'Logos Blockchain GitHub organization',
    org: 'logos-blockchain',
    includeArchived: false,
    includeForks: false,
    maxRepos: githubMaxRepos,
    maxFilesPerRepo: githubMaxFilesPerRepo,
    maxFileBytes: githubMaxFileBytes,
    repoAllowlist: githubRepoAllowlist,
  },
];

const rawGitHubDocuments: RawGitHubDocumentConfig[] = [
  {
    id: 'logos-docs-readme',
    title: 'Build with Logos',
    repo: 'logos-co/logos-docs',
    branch: 'main',
    path: 'README.md',
    sourceType: 'github_readme',
  },
  {
    id: 'logos-blockchain-node-quickstart',
    title: 'Quickstart guide for the Logos Blockchain node',
    repo: 'logos-co/logos-docs',
    branch: 'main',
    path: 'docs/blockchain/quickstart-guide-for-the-logos-blockchain-node.md',
    sourceType: 'github_markdown',
  },
  {
    id: 'logos-execution-zone-wallet-quickstart',
    title: 'Quickstart for the Logos Execution Zone wallet',
    repo: 'logos-co/logos-docs',
    branch: 'main',
    path: 'docs/apps/wallet/journeys/quickstart-for-the-logos-execution-zone-wallet.md',
    sourceType: 'github_markdown',
  },
  {
    id: 'logos-lips-readme',
    title: 'Logos LIP (Logos Improvement Proposals) Index',
    repo: 'logos-co/logos-lips',
    branch: 'main',
    path: 'README.md',
    sourceType: 'github_readme',
  },
  {
    id: 'logos-lips-about',
    title: 'About the Logos LIP Index',
    repo: 'logos-co/logos-lips',
    branch: 'main',
    path: 'docs/about.md',
    sourceType: 'lip',
  },
  {
    id: 'logos-carnot-spec',
    title: 'Carnot Specification',
    repo: 'logos-blockchain/logos-blockchain-specs',
    branch: 'master',
    path: 'deprecated/carnot/spec.md',
    sourceType: 'spec',
  },
];

export const indexerSources: IndexerSource[] = [
  {
    id: 'static-docs',
    title: 'Static Logos seed documents',
    schedule: process.env.INDEXER_STATIC_CRON ?? '17 3 * * *',
    enabled: envFlag('INDEXER_ENABLE_STATIC_SOURCE', true),
    fetch: fetchStaticDocs,
  },
  {
    id: 'raw-github-docs',
    title: 'Curated raw Logos GitHub documents',
    schedule: rawGitHubCron,
    enabled: envFlag('INDEXER_ENABLE_RAW_GITHUB_SOURCES', true),
    fetch: () => fetchRawGitHubDocs(rawGitHubDocuments),
    pruneIdentifierPrefix: 'github-raw:',
    errorRecord: {
      identifier: 'github-raw-source:curated-logos-docs',
      sourceType: 'github_markdown',
      title: 'Curated raw Logos GitHub documents',
      url: 'https://github.com/logos-co/logos-docs',
    },
  },
  ...webSources.map((source) => ({
    id: source.id,
    title: source.title,
    schedule: webCron,
    enabled: envFlag('INDEXER_ENABLE_WEB_SOURCES', true),
    fetch: () => fetchWebDocs(source),
    pruneIdentifierPrefix: `web:${source.id}:`,
    errorRecord: {
      identifier: `web-source:${source.id}`,
      sourceType: source.sourceType,
      title: source.title,
      url: source.baseUrl,
    },
  })),
  ...githubSources.map((source) => ({
    id: source.id,
    title: source.title,
    schedule: githubCron,
    enabled: envFlag('INDEXER_ENABLE_GITHUB_SOURCES', true),
    fetch: () => fetchGitHubDocs(source),
    errorRecord: {
      identifier: `github-org:${source.org}`,
      sourceType: 'github_markdown',
      title: source.title,
      url: `https://github.com/${source.org}`,
    },
  })),
];
