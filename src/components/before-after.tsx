import { FC } from 'react';

interface ComparisonPair {
  before: string;
  after: string;
}

const pairs: ComparisonPair[] = [
  {
    before: 'Team buried in repetitive ops',
    after: 'Agents run workflows 24/7',
  },
  {
    before: 'Hours lost to manual research & reporting',
    after: 'Structured insights delivered in minutes',
  },
  {
    before: 'Disconnected tools held together with duct tape',
    after: 'Unified autonomous workforce across your stack',
  },
  {
    before: 'Growth means hiring, onboarding, waiting',
    after: 'Growth means deploying an agent today',
  },
  {
    before: 'AI hallucinates - no one trusts the output',
    after: 'RAG-grounded agents use only your verified data',
  },
  {
    before: 'Tribal knowledge walks out the door with every quit',
    after: 'Persistent memory - zero knowledge loss, ever',
  },
];

const BeforeAfter: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">Before vs After</h2>
        <div className="w-full h-px bg-white/50 mb-16" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16">
          {/* Left column — Without Agents */}
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-[hsl(220,10%,64%)] mb-8">
              Without Agents
            </p>
            <ul className="flex flex-col gap-6">
              {pairs.map((pair, i) => (
                <li
                  key={i}
                  className="text-base md:text-xl font-light text-[hsl(220,10%,64%)] border-l border-white/10 pl-5"
                >
                  {pair.before}
                </li>
              ))}
            </ul>
          </div>

          {/* Right column — With Our Agent Factory */}
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-[#2FFBF7] mb-8">
              With Our Agent Factory
            </p>
            <ul className="flex flex-col gap-6">
              {pairs.map((pair, i) => (
                <li
                  key={i}
                  className="text-base md:text-xl font-light text-[#E6E6E6] border-l-2 border-[#2FFBF7]/70 pl-5"
                >
                  {pair.after}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};

export default BeforeAfter;
