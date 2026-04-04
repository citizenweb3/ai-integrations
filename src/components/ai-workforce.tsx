import { FC } from 'react';

interface AgentPair {
  ralph: { role: string; tasks: string[] };
  reactive: { role: string; tasks: string[] };
}

const pairs: AgentPair[] = [
  {
    ralph: { role: 'SEO RALPH', tasks: ['Content strategy from RAG data', 'Keyword research', 'Ranking analysis'] },
    reactive: { role: 'SMM + TG Growth', tasks: ['Community engagement', 'Telegram outreach', 'RAG-grounded content'] },
  },
  {
    ralph: { role: 'Dev RALPH', tasks: ['Code analysis', 'PR review', 'Architecture decisions'] },
    reactive: { role: 'Dev Agent', tasks: ['Bug fixing', 'Implementation', 'Testing'] },
  },
  {
    ralph: { role: 'DevOps RALPH', tasks: ['Infrastructure monitoring', 'Performance analysis', 'Incident detection'] },
    reactive: { role: 'DevOps Agent', tasks: ['CI/CD pipelines', 'Deployment automation', 'Scaling'] },
  },
];

const infra = [
  { label: 'RAG', desc: 'Agents grounded in verified data, zero hallucinations' },
  { label: 'Skills', desc: 'Reusable prompts & workflows' },
  { label: 'MCP Tools', desc: 'Connectors to databases, APIs, external systems' },
  { label: 'Memory', desc: 'Persistent context, logging, audit trail' },
];

const AiWorkforce: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">Our AI Workforce</h2>
        <div className="w-full h-px bg-white/50 mb-16" />

        {/* Desktop layout */}
        <div className="hidden lg:block">
          {/* Level 1: Orchestrator */}
          <div className="flex justify-center">
            <div className="border border-[#2FFBF7]/30 px-8 py-3">
              <p className="text-lg font-bold text-[#2FFBF7] text-center tracking-wide">Agent Factory</p>
              <p className="text-sm font-light text-[hsl(220,10%,46%)] text-center mt-1">Orchestrator</p>
            </div>
          </div>

          {/* Vertical line down */}
          <div className="flex justify-center">
            <div className="w-px h-10 bg-white/10" />
          </div>

          {/* Level 2: RALPH layer — horizontal rail + 3 columns */}
          <div className="grid grid-cols-3 gap-8">
            <div className="col-span-3 flex">
              <div className="w-[calc(100%/6+0.5rem)]" />
              <div className="flex-1 h-px bg-white/10" />
              <div className="w-[calc(100%/6+0.5rem)]" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-8">
            {pairs.map((pair) => (
              <div key={pair.ralph.role} className="flex flex-col items-center">
                <div className="w-px h-8 bg-white/10" />
                <div className="w-full border border-white/10 px-5 py-4">
                  <p className="text-sm font-bold uppercase tracking-widest text-[#2FFBF7]/70 mb-0.5">Proactive</p>
                  <p className="text-base font-bold text-[#E6E6E6]">{pair.ralph.role}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {pair.ralph.tasks.map((t) => (
                      <li key={t} className="text-sm font-light text-[hsl(220,10%,46%)]">{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          {/* Vertical lines from RALPH to Reactive */}
          <div className="grid grid-cols-3 gap-8">
            {pairs.map((pair) => (
              <div key={pair.reactive.role} className="flex flex-col items-center">
                <div className="w-px h-8 bg-white/10" />
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-px bg-white/10" />
                  <span className="text-xs font-light text-[hsl(220,10%,46%)]">delegates to</span>
                  <div className="w-4 h-px bg-white/10" />
                </div>
                <div className="w-full border border-white/5 px-5 py-4">
                  <p className="text-sm font-bold uppercase tracking-widest text-[hsl(220,10%,46%)] mb-0.5">Reactive</p>
                  <p className="text-base font-bold text-[#E6E6E6]">{pair.reactive.role}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {pair.reactive.tasks.map((t) => (
                      <li key={t} className="text-sm font-light text-[hsl(220,10%,46%)]">{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          {/* Vertical line to infrastructure */}
          <div className="flex justify-center mt-2">
            <div className="w-px h-10 bg-white/10" />
          </div>

          {/* Level 3: Shared infrastructure */}
          <div className="border-t border-white/10 pt-6">
            <p className="text-sm font-bold uppercase tracking-widest text-[hsl(220,10%,46%)] text-center mb-6">Shared Infrastructure</p>
            <div className="grid grid-cols-4 gap-8">
              {infra.map((item) => (
                <div key={item.label} className="text-center">
                  <p className="text-base font-bold text-[#E6E6E6]">{item.label}</p>
                  <p className="text-sm font-light text-[hsl(220,10%,46%)] mt-1">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile layout */}
        <div className="lg:hidden">
          {/* Orchestrator */}
          <div className="border border-[#2FFBF7]/30 px-6 py-3 w-fit">
            <p className="text-base font-bold text-[#2FFBF7] tracking-wide">Agent Factory</p>
            <p className="text-xs font-light text-[hsl(220,10%,46%)] mt-0.5">Orchestrator</p>
          </div>

          {/* Agent pairs stacked */}
          <div className="ml-6">
            {pairs.map((pair, i) => (
              <div key={pair.ralph.role} className="flex">
                {/* Vertical connector */}
                <div className="flex flex-col items-center mr-5">
                  <div className="w-px h-6 bg-white/10" />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#2FFBF7]/40 shrink-0" />
                  <div className="w-px flex-1 bg-white/10" />
                </div>

                {/* Pair content */}
                <div className="pb-6 pt-3 flex-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#2FFBF7]/70 mb-0.5">Proactive</p>
                  <p className="text-base font-bold text-[#E6E6E6]">{pair.ralph.role}</p>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {pair.ralph.tasks.map((t) => (
                      <li key={t} className="text-sm font-light text-[hsl(220,10%,46%)]">{t}</li>
                    ))}
                  </ul>

                  <div className="flex items-center gap-2 my-3">
                    <div className="w-3 h-px bg-white/10" />
                    <span className="text-xs font-light text-[hsl(220,10%,46%)]">delegates to</span>
                  </div>

                  <p className="text-xs font-bold uppercase tracking-widest text-[hsl(220,10%,46%)] mb-0.5">Reactive</p>
                  <p className="text-base font-bold text-[#E6E6E6]">{pair.reactive.role}</p>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {pair.reactive.tasks.map((t) => (
                      <li key={t} className="text-sm font-light text-[hsl(220,10%,46%)]">{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          {/* Shared infrastructure */}
          <div className="border-t border-white/10 pt-5 mt-2">
            <p className="text-xs font-bold uppercase tracking-widest text-[hsl(220,10%,46%)] mb-4">Shared Infrastructure</p>
            <div className="flex flex-col gap-4">
              {infra.map((item) => (
                <div key={item.label}>
                  <p className="text-base font-bold text-[#E6E6E6]">{item.label}</p>
                  <p className="text-sm font-light text-[hsl(220,10%,46%)] mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AiWorkforce;
