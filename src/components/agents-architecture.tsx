import { FC } from 'react';

const items = [
  'Persistent memory & continuity',
  'Web3-native possibilities',
  'Security by design',
  'Full autonomous teams with decision-making power',
  'Orchestrated workforce with specialized roles',
];

const AgentsArchitecture: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">Custom AI Workforce Architecture & Integration</h2>
        <div className="w-full h-px bg-white/50 mb-16" />
        <div className="space-y-3">
          {items.map((item) => (
            <p key={item} className="text-base md:text-xl font-light">
              {item}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AgentsArchitecture;
