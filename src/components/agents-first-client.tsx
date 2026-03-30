import { FC } from 'react';

const AgentsFirstClient: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">Our first client was ourselves</h2>
        <div className="w-full h-px bg-white/50 mb-16" />
        <p className="text-base md:text-xl font-light leading-relaxed">
          Our First Workforce: Already Running in Production: ValidatorInfo.com is already powered by a full team of
          self-hosted AI agents handling growth, development, outreach, monitoring, and more. We design and deploy the
          same architecture for you
        </p>
      </div>
    </section>
  );
};

export default AgentsFirstClient;
