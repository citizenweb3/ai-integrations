import type { ChatSource } from './types';

type SourceChipsProps = {
  sources: ChatSource[];
};

const SourceChips = ({ sources }: SourceChipsProps) => {
  if (sources.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {sources.slice(0, 6).map((source) => (
        <a
          key={`${source.id}-${source.citationId}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-[10px] border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75 transition hover:border-[#2FFBF7]/60 hover:text-white hover:no-underline"
          title={source.snippet}
        >
          [{source.citationId}] {source.title}
        </a>
      ))}
    </div>
  );
};

export default SourceChips;

