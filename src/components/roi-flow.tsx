import { FC } from 'react';

interface Step {
  label: string;
  detail: string;
  metrics?: string[];
}

const steps: Step[] = [
  {
    label: 'Your Pain',
    detail: 'Manual processes eating your team\'s time. Scaling means hiring. Knowledge gets lost.',
  },
  {
    label: 'Discovery',
    detail: 'We map your workflows, identify automation opportunities, design the agent architecture.',
  },
  {
    label: 'We Build',
    detail: 'Custom agents deployed on your or our infrastructure. Your data stays yours, full control guaranteed.',
  },
  {
    label: 'Agents Work',
    detail: 'Autonomous workforce running 24/7. Proactive analysis, reactive execution, persistent memory.',
  },
  {
    label: 'You Get Results',
    detail: 'Measurable impact from week one.',
    metrics: ['80% less manual work', '24/7 autonomous coverage', 'Zero knowledge loss', 'Predictable scaling costs'],
  },
];

const RoiFlow: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">From Problem to Results</h2>
        <div className="w-full h-px bg-white/50 mb-16" />

        {/* Desktop: horizontal flow */}
        <div className="hidden lg:block">
          <div className="grid grid-cols-5 gap-0">
            {steps.map((step, i) => (
              <div key={step.label} className="flex items-start">
                <div className="flex-1">
                  {/* Step number + connector line */}
                  <div className="flex items-center mb-6">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
                      i === steps.length - 1
                        ? 'border border-[#2FFBF7]/50 text-[#2FFBF7]'
                        : 'border border-white/20 text-[hsl(220,10%,64%)]'
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
                      i === steps.length - 1 ? 'text-[#2FFBF7]' : 'text-[#E6E6E6]'
                    }`}>
                      {step.label}
                    </p>
                    <p className="text-sm font-light text-[hsl(220,10%,64%)] leading-relaxed">
                      {step.detail}
                    </p>
                    {step.metrics && (
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {step.metrics.map((m) => (
                          <li key={m} className="text-sm font-light text-[#E6E6E6]">
                            <span className="text-[#2FFBF7] mr-2">—</span>{m}
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
            <div key={step.label} className="flex">
              {/* Vertical connector */}
              <div className="flex flex-col items-center mr-5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  i === steps.length - 1
                    ? 'border border-[#2FFBF7]/50 text-[#2FFBF7]'
                    : 'border border-white/20 text-[hsl(220,10%,64%)]'
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
                  i === steps.length - 1 ? 'text-[#2FFBF7]' : 'text-[#E6E6E6]'
                }`}>
                  {step.label}
                </p>
                <p className="text-sm font-light text-[hsl(220,10%,64%)] leading-relaxed">
                  {step.detail}
                </p>
                {step.metrics && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {step.metrics.map((m) => (
                      <li key={m} className="text-sm font-light text-[#E6E6E6]">
                        <span className="text-[#2FFBF7] mr-2">—</span>{m}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default RoiFlow;
