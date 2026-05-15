'use client';

import { Children, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

const CodeBlock = ({ children }: { children: ReactNode }) => {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = preRef.current?.innerText ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group relative my-3">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 rounded-[6px] border border-white/15 bg-black/60 px-2 py-1 text-[11px] font-medium text-white/70 opacity-0 transition group-hover:opacity-100 hover:border-[#2FFBF7]/55 hover:text-white focus:opacity-100"
        aria-label={copied ? 'Copied' : 'Copy code'}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-[8px] border border-white/10 bg-black/55 p-3 text-[0.82rem] leading-5"
      >
        {children}
      </pre>
    </div>
  );
};

type MarkdownMessageProps = {
  text: string;
};

const citationPattern = /\[(\d{1,3})]/g;

const childrenToText = (children: ReactNode): string => {
  return Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');
};

const normalizeCodeFences = (text: string): string => {
  const lines = text.split('\n');
  const out: string[] = [];
  let inside = false;

  for (const line of lines) {
    const fenceIndex = line.indexOf('```');
    if (fenceIndex === -1) {
      out.push(line);
      continue;
    }

    if (!inside) {
      out.push(line);
      inside = true;
      continue;
    }

    const before = line.slice(0, fenceIndex + 3);
    const trailing = line.slice(fenceIndex + 3).trim();
    out.push(before);
    if (trailing) out.push(trailing);
    inside = false;
  }

  return out.join('\n');
};

const stripCitationsInSegment = (segment: string): string => {
  return segment
    .replace(citationPattern, (match, _id: string, offset: number, fullText: string) => {
      if (fullText[offset + match.length] === '(') return match;
      return '';
    })
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
};

const stripCitations = (text: string): string => {
  let result = '';
  let cursor = 0;

  while (cursor < text.length) {
    if (text.startsWith('```', cursor)) {
      const end = text.indexOf('```', cursor + 3);
      const stop = end === -1 ? text.length : end + 3;
      result += text.slice(cursor, stop);
      cursor = stop;
      continue;
    }

    if (text[cursor] === '`') {
      const end = text.indexOf('`', cursor + 1);
      const stop = end === -1 ? text.length : end + 1;
      result += text.slice(cursor, stop);
      cursor = stop;
      continue;
    }

    let plainEnd = cursor;
    while (plainEnd < text.length && text[plainEnd] !== '`') plainEnd++;
    result += stripCitationsInSegment(text.slice(cursor, plainEnd));
    cursor = plainEnd;
  }

  return result;
};

const markdownComponents: Components = {
  a: ({ children, href, node, ...props }) => {
    void node;
    const label = childrenToText(children);
    const isCitation = /^\[\d{1,3}]$/.test(label);

    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={
          isCitation
            ? 'mx-0.5 rounded-[4px] border border-[#2FFBF7]/35 bg-[#2FFBF7]/10 px-1 text-[0.78em] font-medium text-[#9AFBFA] transition hover:border-[#2FFBF7]/70 hover:bg-[#2FFBF7]/18 hover:text-white hover:no-underline'
            : 'text-[#9AFBFA] underline decoration-[#2FFBF7]/35 underline-offset-2 transition hover:text-white hover:decoration-[#2FFBF7]'
        }
      >
        {children}
      </a>
    );
  },
  code: ({ children, className, node, ...props }) => {
    void node;
    const isBlock = Boolean(className) || childrenToText(children).includes('\n');

    return (
      <code
        {...props}
        className={
          isBlock
            ? `${className ?? ''} block font-mono text-[0.82rem] leading-5 text-white/90`.trim()
            : 'rounded-[5px] border border-white/10 bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.82em] text-white/90'
        }
      >
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-[#2FFBF7]/40 bg-white/[0.03] px-3 py-2 text-white/80 italic">{children}</blockquote>
  ),
  em: ({ children }) => <em className="italic text-white/95">{children}</em>,
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-xl font-semibold text-white first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 text-lg font-semibold text-white first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-white first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-white/90 first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1 mt-4 text-sm font-semibold text-white/85 first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-white/70 first:mt-0">{children}</h6>,
  hr: () => <hr className="my-4 border-t border-white/10" />,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-[8px] border border-white/10">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  td: ({ children }) => <td className="border-t border-white/10 px-3 py-2 text-white/85">{children}</td>,
  th: ({ children }) => <th className="bg-white/[0.05] px-3 py-2 font-semibold text-white">{children}</th>,
  thead: ({ children }) => <thead>{children}</thead>,
  tr: ({ children }) => <tr>{children}</tr>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5">{children}</ul>,
};

const MarkdownMessage = ({ text }: MarkdownMessageProps) => {
  return (
    <div className="leading-6">
      <ReactMarkdown
        components={markdownComponents}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        remarkPlugins={[remarkGfm]}
      >
        {stripCitations(normalizeCodeFences(text))}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownMessage;
