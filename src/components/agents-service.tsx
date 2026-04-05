import { FC } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface ServiceStep {
  title: string;
  detail: string;
  metrics?: string[];
  highlight?: boolean;
}

const steps: ServiceStep[] = [
  {
    title: 'Discovery & Architecture',
    detail: 'We audit your workflows, identify what to automate, and design the agent system tailored to your business.',
  },
  {
    title: 'Agent Development',
    detail: 'Custom agents built with your domain knowledge, integrated with your tools via MCP, APIs, and RAG.',
  },
  {
    title: 'Deployment',
    detail: 'Self-hosted or hybrid. Agents go live on your or our infrastructure with full monitoring from day one.',
  },
  {
    title: 'Management & Upgrades',
    detail: 'Ongoing support, model migrations, new agent roles, performance tuning. Optional — you can run it yourself.',
  },
  {
    title: 'You Get Results',
    detail: 'Measurable impact from week one.',
    highlight: true,
    metrics: ['80% less manual work', '24/7 autonomous coverage', 'Zero knowledge loss', 'Predictable scaling costs'],
  },
];

const wideBtnClass =
  'hover:no-underline relative py-4 px-12 md:py-5 md:px-20 font-bold inline-block text-lg md:text-2xl text-center bg-[#1A1A1B] rounded-[9px] hover:bg-[#ffffff]/15 cursor-pointer';

const AgentsService: FC = () => {
  return (
    <section className="pt-8 md:pt-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">The Service</h2>
        <div className="w-full h-px bg-white/50 mb-16" />

        {/* Desktop: horizontal flow */}
        <div className="hidden lg:block">
          <div className="grid grid-cols-5 gap-0">
            {steps.map((step, i) => (
              <div key={step.title} className="flex items-start">
                <div className="flex-1">
                  {/* Step number + connector line */}
                  <div className="flex items-center mb-6">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
                      step.highlight
                        ? 'border border-[#2FFBF7]/50 text-[#2FFBF7]'
                        : 'border border-white/20 text-[hsl(220,10%,46%)]'
                    }`}>
                      {i + 1}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="flex-1 h-px bg-white/10 mx-2" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pr-6">
                    <p className={`text-base font-bold mb-2 ${
                      step.highlight ? 'text-[#2FFBF7]' : 'text-[#E6E6E6]'
                    }`}>
                      {step.title}
                    </p>
                    <p className="text-sm font-light text-[hsl(220,10%,46%)] leading-relaxed">
                      {step.detail}
                    </p>
                    {step.metrics && (
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {step.metrics.map((m) => (
                          <li key={m} className="text-sm font-light text-[#E6E6E6]">
                            <span className="text-[#2FFBF7]/60 mr-2">—</span>{m}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile: vertical flow */}
        <div className="lg:hidden">
          {steps.map((step, i) => (
            <div key={step.title} className="flex">
              {/* Vertical connector */}
              <div className="flex flex-col items-center mr-5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  step.highlight
                    ? 'border border-[#2FFBF7]/50 text-[#2FFBF7]'
                    : 'border border-white/20 text-[hsl(220,10%,46%)]'
                }`}>
                  {i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 bg-white/10" />
                )}
              </div>

              {/* Content */}
              <div className="pb-8 pt-0.5">
                <p className={`text-base font-bold mb-1 ${
                  step.highlight ? 'text-[#2FFBF7]' : 'text-[#E6E6E6]'
                }`}>
                  {step.title}
                </p>
                <p className="text-sm font-light text-[hsl(220,10%,46%)] leading-relaxed">
                  {step.detail}
                </p>
                {step.metrics && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {step.metrics.map((m) => (
                      <li key={m} className="text-sm font-light text-[#E6E6E6]">
                        <span className="text-[#2FFBF7]/60 mr-2">—</span>{m}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-16">
          <Link href="https://t.me/citizenweb3" target="_blank" rel="noopener noreferrer" className={wideBtnClass}>
            <Image src="/arrow.svg" alt="arrow" width={12} height={12} className="absolute top-3 right-3 w-3 h-auto" />
            Quote
          </Link>
        </div>
      </div>
    </section>
  );
};

export default AgentsService;
