import { FC } from 'react';
import LinkButton from '@/components/link-button';

interface CostFactor {
  label: string;
  description: string;
  details: string[];
}

const factors: CostFactor[] = [
  {
    label: 'Agent Configuration',
    description: 'Number and type of agents set the base scope.',
    details: [
      'Each domain gets a RALPH (proactive) + Reactive agent pair',
      'Agent Factory orchestrator coordinates multi-domain setups',
      'More domains = broader automation coverage',
    ],
  },
  {
    label: 'Infrastructure',
    description: 'Where and how your agents run.',
    details: [
      'Self-hosted on your servers or managed by us',
      'RAG pipeline, vector database, persistent memory',
      'LLM API costs depend on provider and usage',
    ],
  },
  {
    label: 'Integration Complexity',
    description: 'How deeply agents connect to your existing systems.',
    details: [
      'MCP connectors to databases, APIs, and internal tools',
      'Custom tool development for domain-specific workflows',
      'Number of external systems and data sources',
    ],
  },
  {
    label: 'Ongoing Management',
    description: 'Optional — you can run everything yourself.',
    details: [
      'Model migrations and performance tuning',
      'Monitoring, incident response, agent updates',
      'New agent roles and capability expansion',
    ],
  },
];

const scales = [
  { scope: 'Single Department', example: '1 agent pair, 1 domain — e.g. Development or SEO' },
  { scope: 'Multi-Domain Team', example: '3 agent pairs + orchestrator — e.g. Dev + SMM + DevOps' },
  { scope: 'Full AI Workforce', example: '6+ agent pairs, full domain coverage with shared infrastructure' },
];

const Pricing: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">How Pricing Works</h2>
        <div className="w-full h-px bg-white/50 mb-12" />

        <p className="text-base md:text-xl font-light leading-relaxed text-[hsl(220,10%,66%)] mb-12">
          Pricing depends on four factors:
        </p>

        {/* Cost factors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-10 gap-x-6 md:gap-x-12 mb-16">
          {factors.map((f) => (
            <div key={f.label} className="border-l-2 border-white/10 pl-5">
              <p className="text-base font-bold text-[#E6E6E6] mb-1">{f.label}</p>
              <p className="text-sm font-light text-[hsl(220,10%,64%)] leading-relaxed mb-3">{f.description}</p>
              <ul className="flex flex-col gap-1.5">
                {f.details.map((d) => (
                  <li key={d} className="text-sm font-light text-[hsl(220,10%,66%)] flex items-start gap-2">
                    <span className="text-[#2FFBF7] mt-0.5 shrink-0">{'\u2014'}</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Scale examples */}
        <div className="border-t border-white/10 pt-10 mb-12">
          <p className="text-sm font-bold uppercase tracking-widest text-[hsl(220,10%,64%)] mb-6">
            Typical Deployment Scales
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {scales.map((s) => (
              <div key={s.scope}>
                <p className="text-base font-bold text-[#E6E6E6] mb-1">{s.scope}</p>
                <p className="text-sm font-light text-[hsl(220,10%,64%)] leading-relaxed">{s.example}</p>
              </div>
            ))}
          </div>
        </div>
        <LinkButton buttonText={'Book a 15-min Call'} />
      </div>
    </section>
  );
};

export default Pricing;
