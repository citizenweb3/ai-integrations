const sourceGroups = [
  'Official Logos websites and builder documentation',
  'Logos GitHub repositories, LIPs, and technical specs',
  'Waku messaging docs and indexed source references',
];

const WelcomeMessage = () => {
  return (
    <div className="flex items-center justify-center text-center">
      <div className="max-w-2xl">
        <div className="mx-auto mb-6 h-px w-40 bg-white/40" />
        <p className="text-2xl font-semibold tracking-[0.05em] text-white">
          Ask about Logos nodes, LIPs, messaging, storage, or consensus.
        </p>
        <p className="mt-4 text-sm leading-6 text-white/55">
          This chat retrieves from indexed Logos websites, docs, GitHub repositories, and source material. It answers with citations so builders can jump back to the original context.
        </p>
        <div className="mx-auto mt-5 max-w-2xl text-xs leading-6 text-white/42">
          <span className="font-semibold uppercase tracking-[0.12em] text-white/60">Indexed corpus:</span>{' '}
          <ul className="inline">
            {sourceGroups.map((sourceGroup) => (
              <li key={sourceGroup} className="inline">
                <span>{sourceGroup}</span>
                {sourceGroup !== sourceGroups[sourceGroups.length - 1] && <span className="text-white/25"> / </span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default WelcomeMessage;
