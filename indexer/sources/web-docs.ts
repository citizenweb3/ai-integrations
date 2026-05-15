import { JSDOM } from 'jsdom';

import { fetchReadablePage } from '../fetchers/html';
import { assertAllowedUrl, discoverRobotsSitemaps, fetchTextWithMetadata } from '../fetchers/http';
import { discoverSitemapUrls } from '../fetchers/sitemap';
import type { FetchedDocument } from '../types';

export type WebSourceConfig = {
  id: string;
  title: string;
  sourceType: string;
  baseUrl: string;
  sitemapUrls: string[];
  fallbackUrls: string[];
  allowedHosts: string[];
  maxPages: number;
};

const identifierFor = (source: WebSourceConfig, url: string): string => {
  return `web:${source.id}:${new URL(url).href}`;
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

const assetPathPattern =
  /\.(?:avif|css|eot|gif|gz|ico|jpe?g|js|json|mp3|mp4|pdf|png|rss|svg|tar|ttf|webm|webp|woff2?|xml|zip)$/i;

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

const normalizePageUrl = (source: WebSourceConfig, href: string, baseUrl: string): string | null => {
  try {
    const parsed = assertAllowedUrl(new URL(href, baseUrl).href, source.allowedHosts);
    const sourceBase = new URL(source.baseUrl);

    if (parsed.hostname !== sourceBase.hostname) return null;
    if (assetPathPattern.test(parsed.pathname)) return null;

    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
};

const discoverLinkedUrls = async (source: WebSourceConfig): Promise<string[]> => {
  const seeds = source.fallbackUrls.length > 0 ? source.fallbackUrls : [source.baseUrl];
  const queue = unique(
    seeds
      .map((url) => normalizePageUrl(source, url, source.baseUrl))
      .filter((url): url is string => Boolean(url)),
  );
  const seen = new Set<string>();
  const discovered: string[] = [];
  const maxQueueSize = Math.max(source.maxPages * 5, source.maxPages);

  for (let index = 0; index < queue.length && discovered.length < source.maxPages; index += 1) {
    const url = queue[index];
    if (!url || seen.has(url)) continue;

    seen.add(url);
    discovered.push(url);

    try {
      const { text: html, finalUrl } = await fetchTextWithMetadata({ url, allowedHosts: source.allowedHosts });
      const dom = new JSDOM(html, { url: finalUrl });
      const links = Array.from(dom.window.document.querySelectorAll<HTMLAnchorElement>('a[href]'))
        .map((anchor) => normalizePageUrl(source, anchor.href, finalUrl))
        .filter((link): link is string => Boolean(link));

      for (const link of links) {
        if (seen.has(link) || queue.includes(link) || queue.length >= maxQueueSize) continue;
        queue.push(link);
      }
    } catch (error) {
      warn('link_crawl_failed', {
        sourceId: source.id,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return unique(discovered).slice(0, source.maxPages);
};

const discoverSourceUrls = async (source: WebSourceConfig): Promise<string[]> => {
  let sitemapUrls = source.sitemapUrls;

  try {
    sitemapUrls = unique([...sitemapUrls, ...(await discoverRobotsSitemaps(source.baseUrl, source.allowedHosts))]);
  } catch (error) {
    warn('robots_sitemap_discovery_failed', {
      sourceId: source.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (sitemapUrls.length > 0) {
    try {
      const urls = await discoverSitemapUrls({
        sitemapUrls,
        allowedHosts: source.allowedHosts,
        maxUrls: source.maxPages,
      });
      if (urls.length > 0) return urls;
      throw new Error(`No URLs discovered from ${sitemapUrls.length} sitemap(s)`);
    } catch (error) {
      throw new Error(
        `Sitemap discovery failed for ${source.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const linkedUrls = await discoverLinkedUrls(source);
  if (linkedUrls.length > 0) return linkedUrls;

  return source.fallbackUrls.slice(0, source.maxPages);
};

export const fetchWebDocs = async (source: WebSourceConfig): Promise<FetchedDocument[]> => {
  const urls = await discoverSourceUrls(source);

  const documents: FetchedDocument[] = [];
  let failedPages = 0;

  for (const url of urls) {
    try {
      const page = await fetchReadablePage(url, source.allowedHosts);
      documents.push({
        identifier: identifierFor(source, page.url),
        sourceType: source.sourceType,
        title: page.title,
        url: page.url,
        content: page.content,
        sectionPath: source.title,
        language: 'en',
        metadata: {
          sourceId: source.id,
          baseUrl: source.baseUrl,
          fetchedFromSitemap: !source.fallbackUrls.includes(url),
        },
      });
    } catch (error) {
      failedPages += 1;
      warn('web_page_fetch_failed', {
        sourceId: source.id,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failedPages > 0 && documents.length === 0) {
    throw new Error(`${failedPages} of ${urls.length} web pages failed for ${source.id}`);
  }

  if (failedPages > 0) {
    warn('web_source_partial_fetch', {
      sourceId: source.id,
      failedPages,
      fetchedPages: documents.length,
    });
  }

  return documents;
};
