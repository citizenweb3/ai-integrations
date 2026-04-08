import { FC } from 'react';

interface DomainCase {
  domain: string;
  items: string;
  effect: string;
}

const cases: DomainCase[] = [
  {
    domain: 'Development',
    items: 'Code review, PR automation, bug fixes, refactoring, test generation, dependency updates, documentation',
    effect: 'PR review: 2 hours \u2192 15 min',
  },
  {
    domain: 'SMM & Growth',
    items: 'Content plans, Telegram outreach, community engagement, cross-platform adaptation, engagement analytics',
    effect: '10x content output, same team',
  },
  {
    domain: 'SEO & Content',
    items: 'Keyword research, ranking analysis, RAG-powered generation, competitor monitoring, meta optimization',
    effect: 'Content plan from real data',
  },
  {
    domain: 'DevOps',
    items: 'Infrastructure monitoring, CI/CD, deployment, scaling, log analysis, anomaly alerts, auto-rollback',
    effect: '24/7 monitoring, no on-call',
  },
  {
    domain: 'Customer Support',
    items: 'L1 tickets, FAQ, request routing, knowledge base, multilingual responses, L2 handoff summaries',
    effect: '80% tickets closed by agents',
  },
  {
    domain: 'Research & Analytics',
    items: 'Data collection, market monitoring, competitor analysis, trend detection, executive summaries',
    effect: 'Daily reports in minutes',
  },
  {
    domain: 'Operations',
    items: 'Documentation, onboarding materials, process automation, meeting notes, compliance checks',
    effect: 'Zero knowledge loss',
  },
  {
    domain: 'Sales & Outreach',
    items: 'Lead scoring, personalized sequences, CRM enrichment, follow-up scheduling, pipeline forecasting',
    effect: '3x qualified leads per rep',
  },
  {
    domain: 'Finance & Reporting',
    items: 'Invoice processing, expense categorization, budget alerts, cash flow forecasting, regulatory reports',
    effect: 'Month-end close in hours',
  },
];

const AutomationCases: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">What Can Be Automated</h2>
        <div className="w-full h-px bg-white/50 mb-12" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-10 gap-x-6 md:gap-x-12">
          {cases.map((c) => (
            <div key={c.domain} className="border-l-2 border-[#2FFBF7]/20 pl-5">
              <p className="text-base font-bold text-[#E6E6E6] mb-1">{c.domain}</p>
              <p className="text-sm font-light text-[hsl(220,10%,64%)] leading-relaxed mb-3">
                {c.items}
              </p>
              <p className="text-sm font-medium text-[#2FFBF7]">{c.effect}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AutomationCases;
