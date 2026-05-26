import { FC } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

interface ProjectLink {
  label: string;
  href: string;
}

interface Project {
  name: string;
  description: string;
  links: ProjectLink[];
  wip?: boolean;
}

const projects: Project[] = [
  {
    name: 'Aida — Telegram Growth Agent',
    description:
      'Autonomous Telegram agent: joins Web3 groups, answers from on-chain data + podcast RAG, grows the community under human approval.',
    links: [
      { label: 'GitHub', href: 'https://github.com/citizenweb3/ai-integrations/tree/aida-trust-first-rewrite' },
    ],
  },
  {
    name: 'ValidatorInfo — RAG Assistant',
    description:
      'In-product RAG over the CW3 podcast corpus + on-chain validator data. A single API that powers the whole agent fleet.',
    links: [
      { label: 'GitHub', href: 'https://github.com/citizenweb3/validatorinfo' },
      { label: 'Live', href: 'https://validatorinfo.com' },
    ],
  },
  {
    name: 'ValidatorInfo — Fullstack Developer',
    description:
      'Self-hosted GitHub Actions runner that ships features and fixes against the ValidatorInfo codebase via Claude Code.',
    links: [
      { label: 'GitHub', href: 'https://github.com/citizenweb3/validatorinfo/tree/dev/agents-infrastructure' },
      { label: 'Live', href: 'https://validatorinfo.com' },
    ],
  },
  {
    name: 'ValidatorInfo — Content Creator',
    description:
      'Per-brand self-hosted runners generating and publishing content to Twitter, Telegram and Discord from indexed data.',
    links: [
      { label: 'GitHub', href: 'https://github.com/citizenweb3/validatorinfo/tree/dev/agents-infrastructure' },
      { label: 'Live', href: 'https://validatorinfo.com' },
    ],
  },
  {
    name: 'Upwork Agent',
    description:
      'Autonomous Upwork job search, scoring and proposal drafting — human-in-the-loop control via Telegram.',
    links: [{ label: 'GitHub', href: 'https://github.com/citizenweb3/upwork-agent' }],
  },
  {
    name: 'Logos Chatbot',
    description:
      'RAG onboarding assistant for the Logos network — grounded answers for users, developers and validators.',
    links: [
      { label: 'GitHub', href: 'https://github.com/citizenweb3/ai-integrations/tree/logos-onboarding-assistant' },
      { label: 'Live', href: 'https://logos.staking.citizenweb3.com' },
    ],
  },
  {
    name: 'AI Integrations CLI',
    description:
      'npm package of AI agent skills for blockchain node operators — install, update and manage validator nodes in natural language.',
    links: [
      { label: 'GitHub', href: 'https://github.com/citizenweb3/ai-integrations/tree/installer' },
      { label: 'npm', href: 'https://www.npmjs.com/package/@citizenweb3/ai-integrations' },
    ],
  },
  {
    name: 'Bizdev Email Agent',
    description:
      'Autonomous outbound: prospect discovery, research, personalized drafting, Telegram approval, send and reply capture.',
    links: [],
    wip: true,
  },
];

const OurOpenSourceExamples: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">Our Open Source Examples</h2>
        <div className="w-full h-px bg-white/50 mb-3" />
        <p className="text-sm md:text-base font-light text-[hsl(220,10%,64%)] leading-relaxed mb-12">
          The agents behind our own factory — most of them open, all of them in production.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-10 gap-x-6 md:gap-x-12">
          {projects.map((p) => (
            <div
              key={p.name}
              className="group flex flex-col border-l-2 border-[#2FFBF7]/20 pl-5 transition-colors duration-300 hover:border-[#2FFBF7]/60"
            >
              <p className="text-base font-bold text-[#E6E6E6] mb-1">{p.name}</p>
              <p className="text-sm font-light text-[hsl(220,10%,64%)] leading-relaxed mb-4 grow">
                {p.description}
              </p>

              {p.wip ? (
                <span className="text-xs font-medium uppercase tracking-widest text-[hsl(220,10%,64%)]">
                  WIP
                </span>
              ) : (
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {p.links.map((l) => (
                    <Link
                      key={l.label}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-[#2FFBF7] hover:no-underline"
                    >
                      {l.label}
                      <ArrowUpRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default OurOpenSourceExamples;
