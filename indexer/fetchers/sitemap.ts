import { XMLParser } from 'fast-xml-parser';

import { assertAllowedUrl, fetchText } from './http';

type DiscoverSitemapUrlsOptions = {
  sitemapUrls: string[];
  allowedHosts: string[];
  maxUrls: number;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

const collectFromSitemap = async (
  sitemapUrl: string,
  allowedHosts: string[],
  remaining: number,
  seenSitemaps: Set<string>,
): Promise<string[]> => {
  if (seenSitemaps.has(sitemapUrl) || remaining <= 0) return [];
  seenSitemaps.add(sitemapUrl);

  assertAllowedUrl(sitemapUrl, allowedHosts);
  const xml = await fetchText({ url: sitemapUrl, allowedHosts });
  const parsed = parser.parse(xml) as {
    urlset?: { url?: { loc?: string } | { loc?: string }[] };
    sitemapindex?: { sitemap?: { loc?: string } | { loc?: string }[] };
  };

  const urls = toArray(parsed.urlset?.url)
    .map((entry) => entry.loc)
    .filter((loc): loc is string => Boolean(loc))
    .filter((loc) => {
      try {
        assertAllowedUrl(loc, allowedHosts);
        return true;
      } catch {
        return false;
      }
    });

  if (urls.length > 0) return urls.slice(0, remaining);

  const nestedSitemaps = toArray(parsed.sitemapindex?.sitemap)
    .map((entry) => entry.loc)
    .filter((loc): loc is string => Boolean(loc));
  const collected: string[] = [];

  for (const nested of nestedSitemaps) {
    const nestedUrls = await collectFromSitemap(nested, allowedHosts, remaining - collected.length, seenSitemaps);
    collected.push(...nestedUrls);
    if (collected.length >= remaining) break;
  }

  return collected.slice(0, remaining);
};

export const discoverSitemapUrls = async ({
  sitemapUrls,
  allowedHosts,
  maxUrls,
}: DiscoverSitemapUrlsOptions): Promise<string[]> => {
  const collected: string[] = [];
  const seenSitemaps = new Set<string>();

  for (const sitemapUrl of sitemapUrls) {
    const urls = await collectFromSitemap(sitemapUrl, allowedHosts, maxUrls - collected.length, seenSitemaps);
    collected.push(...urls);
    if (collected.length >= maxUrls) break;
  }

  return unique(collected).slice(0, maxUrls);
};
