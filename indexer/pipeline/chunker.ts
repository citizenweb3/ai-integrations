import type { DocumentChunk, FetchedDocument } from '../types';

export const MIN_CHUNK_WORDS = 80;
export const MAX_CHUNK_WORDS = 600;
export const OVERLAP_WORDS = 100;
export const MIN_LINK_FREE_WORDS = 30;

type Section = {
  body: string;
  sectionPath: string | null;
};

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const stripMarkdownLinks = (text: string): string =>
  text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<https?:[^>]+>/g, '');

const cleanHeadingText = (text: string): string => text.replace(/[*_`#]/g, '').trim();

const joinSectionPath = (stack: (string | null)[], fallback: string | null): string | null => {
  const parts = stack.filter((s): s is string => Boolean(s && s.trim()));
  if (parts.length === 0) return fallback;
  return parts.join(' > ');
};

const splitWithOverlap = (text: string, maxWords: number, overlapWords: number): string[] => {
  if (overlapWords >= maxWords) {
    throw new Error('overlapWords must be < maxWords');
  }

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const result: string[] = [];
  let currentParts: string[] = [];
  let currentWords = 0;

  const flushCurrent = (): void => {
    if (currentParts.length === 0) return;
    result.push(currentParts.join('\n\n'));
    if (currentWords <= overlapWords) {
      currentParts = [];
      currentWords = 0;
      return;
    }
    const tail: string[] = [];
    let tailWords = 0;
    for (let i = currentParts.length - 1; i >= 0 && tailWords < overlapWords; i--) {
      const para = currentParts[i];
      tail.unshift(para);
      tailWords += wordCount(para);
    }
    currentParts = tail;
    currentWords = tailWords;
  };

  for (const para of paragraphs) {
    const paraWords = wordCount(para);

    if (paraWords > maxWords) {
      flushCurrent();
      const words = para.split(/\s+/).filter(Boolean);
      let start = 0;
      while (start < words.length) {
        const end = Math.min(start + maxWords, words.length);
        result.push(words.slice(start, end).join(' '));
        if (end >= words.length) break;
        start = end - overlapWords;
      }
      currentParts = [];
      currentWords = 0;
      continue;
    }

    if (currentWords + paraWords > maxWords && currentParts.length > 0) {
      flushCurrent();
    }

    currentParts.push(para);
    currentWords += paraWords;
  }

  if (currentParts.length > 0) {
    result.push(currentParts.join('\n\n'));
  }

  return result;
};

const parseSections = (document: FetchedDocument): Section[] => {
  const content = document.content;
  if (!content.trim()) return [];

  const headingStack: [string | null, string | null, string | null] = [null, null, null];
  let pendingPath: string | null = document.sectionPath ?? null;
  let buffer = '';
  const sections: Section[] = [];

  const flush = (path: string | null): void => {
    if (buffer.trim().length === 0) {
      buffer = '';
      return;
    }
    sections.push({ body: buffer.trim(), sectionPath: path });
    buffer = '';
  };

  const lines = content.split('\n');
  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0].repeat(3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = '';
      }
      buffer += `${line}\n`;
      continue;
    }

    if (inFence) {
      buffer += `${line}\n`;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flush(pendingPath);
      const level = headingMatch[1].length;
      const title = cleanHeadingText(headingMatch[2]);
      if (level === 1) {
        headingStack[0] = title;
        headingStack[1] = null;
        headingStack[2] = null;
      } else if (level === 2) {
        headingStack[1] = title;
        headingStack[2] = null;
      } else {
        headingStack[2] = title;
      }
      pendingPath = joinSectionPath(headingStack, document.sectionPath ?? null);
      continue;
    }

    buffer += `${line}\n`;
  }

  flush(pendingPath);
  return sections;
};

const metaString = (document: FetchedDocument, key: string): string | undefined => {
  const value = document.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const urlHost = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

const sourceTypeLabel = (document: FetchedDocument): string => {
  const repo = metaString(document, 'repo');
  const host = urlHost(document.url);
  switch (document.sourceType) {
    case 'static_seed':
      return 'Logos scaffold overview';
    case 'lip':
      return repo ? `Logos Improvement Proposal (LIP) in ${repo}` : 'Logos Improvement Proposal (LIP)';
    case 'spec':
      return repo ? `Logos Blockchain specification in ${repo}` : 'Logos Blockchain specification';
    case 'github_readme':
      return repo ? `GitHub README of ${repo}` : 'GitHub README';
    case 'github_markdown':
      return repo ? `GitHub document in ${repo}` : 'GitHub document';
    case 'docs_site':
      return host ? `Documentation site ${host}` : 'Documentation site';
    case 'html':
      return host ? `Web page on ${host}` : 'Web page';
    default:
      return host ?? document.sourceType;
  }
};

const buildContextPrefix = (document: FetchedDocument, sectionPath: string | null): string => {
  const label = sourceTypeLabel(document);
  const sectionLine = sectionPath ? `\nSection: ${sectionPath}.` : '';
  return `Title: ${document.title} (${label}).${sectionLine}`;
};

const emitChunk = (
  document: FetchedDocument,
  content: string,
  sectionPath: string | null,
  chunkIndex: number,
): DocumentChunk => {
  const contextPrefix = buildContextPrefix(document, sectionPath);
  return {
    chunkIndex,
    sectionPath,
    content,
    contextPrefix,
    contentForEmbed: `${contextPrefix}\n\n${content}`,
    tokenCount: wordCount(content),
    language: document.language ?? 'en',
  };
};

export const chunkDocument = (document: FetchedDocument): DocumentChunk[] => {
  if (!document.content.trim()) return [];

  const rawSections = parseSections(document);
  const proseSections = rawSections.filter(
    (section) => wordCount(stripMarkdownLinks(section.body)) >= MIN_LINK_FREE_WORDS,
  );

  if (proseSections.length === 0) return [];

  const chunks: DocumentChunk[] = [];
  let mergeBuffer: string | null = null;
  let mergePath: string | null = null;

  for (const section of proseSections) {
    const body: string = mergeBuffer ? `${mergeBuffer}\n\n${section.body}` : section.body;
    const path: string | null = mergeBuffer ? mergePath : section.sectionPath;
    mergeBuffer = null;
    mergePath = null;

    const wc = wordCount(body);

    if (wc < MIN_CHUNK_WORDS) {
      mergeBuffer = body;
      mergePath = path;
      continue;
    }

    if (wc > MAX_CHUNK_WORDS) {
      const parts = splitWithOverlap(body, MAX_CHUNK_WORDS, OVERLAP_WORDS);
      for (const part of parts) {
        if (!part.trim()) continue;
        chunks.push(emitChunk(document, part, path, chunks.length));
      }
      continue;
    }

    chunks.push(emitChunk(document, body, path, chunks.length));
  }

  if (mergeBuffer && mergeBuffer.trim().length > 0) {
    const tail = mergeBuffer.trim();
    if (chunks.length === 0) {
      if (wordCount(tail) >= MIN_CHUNK_WORDS) {
        chunks.push(emitChunk(document, tail, mergePath, 0));
      }
    } else {
      const last = chunks[chunks.length - 1];
      const merged = `${last.content}\n\n${tail}`;
      if (wordCount(merged) > MAX_CHUNK_WORDS) {
        const parts = splitWithOverlap(merged, MAX_CHUNK_WORDS, OVERLAP_WORDS);
        chunks.pop();
        for (const part of parts) {
          if (!part.trim()) continue;
          chunks.push(emitChunk(document, part, last.sectionPath, chunks.length));
        }
      } else {
        chunks[chunks.length - 1] = emitChunk(document, merged, last.sectionPath, last.chunkIndex);
      }
    }
  }

  return chunks;
};
