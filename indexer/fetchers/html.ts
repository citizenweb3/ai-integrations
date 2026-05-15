import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

import { fetchTextWithMetadata } from './http';

type ReadablePage = {
  title: string;
  content: string;
  url: string;
};

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

turndown.remove(['img', 'picture', 'source']);

const normalizeMarkdown = (markdown: string): string => {
  return markdown
    .replace(/\r/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const navPatterns = [
  /^skip to (main )?content/i,
  /^table of contents$/i,
  /^on this page$/i,
  /^(previous|next)( page)?$/i,
  /^edit (this )?page$/i,
  /^breadcrumbs?$/i,
];

const stripNavBoilerplate = (markdown: string): string => {
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (navPatterns.some((re) => re.test(trimmed))) continue;
    const linkCount = (line.match(/\[[^\]]+]\([^)]+\)/g) ?? []).length;
    const plain = line
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/`/g, '')
      .trim();
    if (linkCount >= 2 && plain.length < 8) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const fallbackBodyText = (dom: JSDOM): string => {
  const document = dom.window.document;
  document.querySelectorAll('script, style, nav, footer, header, noscript').forEach((element) => element.remove());
  return normalizeMarkdown(document.body?.textContent ?? '');
};

export const fetchReadablePage = async (url: string, allowedHosts: string[]): Promise<ReadablePage> => {
  const { text: html, finalUrl } = await fetchTextWithMetadata({ url, allowedHosts });
  const dom = new JSDOM(html, { url: finalUrl });
  const fallbackDom = new JSDOM(html, { url: finalUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const title =
    article?.title?.trim() ||
    fallbackDom.window.document.querySelector('title')?.textContent?.trim() ||
    new URL(finalUrl).pathname ||
    finalUrl;
  const content = article?.content
    ? stripNavBoilerplate(normalizeMarkdown(turndown.turndown(article.content)))
    : stripNavBoilerplate(fallbackBodyText(fallbackDom));

  if (content.length < 120) {
    throw new Error(`Readable content is too short for ${finalUrl}`);
  }

  return {
    title,
    content,
    url: finalUrl,
  };
};
