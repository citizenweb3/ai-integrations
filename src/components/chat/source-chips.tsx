import type { ChatSource } from './types';

type SourceChipsProps = {
  sources: ChatSource[];
  text?: string;
};

const CITATION_PATTERN = /\[(\d{1,3})]/g;
const FALLBACK_LIMIT = 6;

const citedSourcesInOrder = (sources: ChatSource[], text: string): ChatSource[] => {
  const byId = new Map(sources.map((source) => [source.citationId, source]));
  const seenIds = new Set<number>();
  const ordered: ChatSource[] = [];

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const id = Number(match[1]);
    if (seenIds.has(id)) continue;
    const source = byId.get(id);
    if (!source) continue;
    seenIds.add(id);
    ordered.push(source);
  }

  return ordered;
};

const dedupeByUrl = (sources: ChatSource[]): ChatSource[] => {
  const seenUrls = new Set<string>();
  const result: ChatSource[] = [];
  for (const source of sources) {
    if (seenUrls.has(source.url)) continue;
    seenUrls.add(source.url);
    result.push(source);
  }
  return result;
};

const SourceChips = ({ sources, text }: SourceChipsProps) => {
  if (sources.length === 0) return null;

  const cited = text ? citedSourcesInOrder(sources, text) : [];
  const base = cited.length > 0 ? cited : sources;
  const deduped = dedupeByUrl(base);
  const visible = cited.length > 0 ? deduped : deduped.slice(0, FALLBACK_LIMIT);

  if (visible.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-white/55">Read more:</div>
      <div className="flex flex-wrap gap-2">
        {visible.map((source) => (
          <a
            key={`${source.id}-${source.citationId}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-[10px] border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75 transition hover:border-[#2FFBF7]/60 hover:text-white hover:no-underline"
            title={source.snippet}
          >
            {source.title}
          </a>
        ))}
      </div>
    </div>
  );
};

export default SourceChips;

