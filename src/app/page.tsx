import type { Metadata } from 'next';

import LogosChat from '@/components/chat/logos-chat';

export const metadata: Metadata = {
  title: 'Logos Onboarding Assistant | Context-grounded Logos AI assistant',
  description:
    'Ask questions about Logos nodes, LIPs, Cryptarchia consensus, Waku messaging, storage, GitHub repositories, and builder documentation with cited source links.',
  keywords: [
    'Logos chatbot',
    'Logos onboarding',
    'Logos node',
    'Logos Improvement Proposals',
    'LIPs',
    'Cryptarchia consensus',
    'Waku messaging',
    'Logos Execution Zone',
    'Logos developer docs',
    'Logos GitHub',
  ],
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    title: 'Logos Onboarding Assistant',
    description:
      'Context-grounded Logos assistant for node operators, builders, and newcomers. Answers include citations to indexed Logos source material.',
    url: '/',
    siteName: 'Logos Onboarding Assistant',
  },
  twitter: {
    card: 'summary',
    title: 'Logos Onboarding Assistant',
    description:
      'Ask Logos onboarding questions and get cited answers from docs, GitHub repositories, and official web sources.',
  },
};

const Page = () => {
  return (
    <main className="flex h-dvh flex-col bg-black text-white">
      <section className="mx-auto flex h-full w-full max-w-[96rem] min-h-0 flex-col px-5 py-5 md:px-8">
        <header className="flex items-center justify-between border-b border-white/15 pb-4">
          <a href="https://logos.co" className="text-xl font-bold tracking-[0.12em] hover:no-underline">
            LOGOS
          </a>
          <nav aria-label="Primary" className="flex items-center gap-5 text-sm text-white/65">
            <a href="https://logos.co" target="_blank" rel="noreferrer">
              Website
            </a>
            <a href="https://build.logos.co" target="_blank" rel="noreferrer">
              Builders
            </a>
            <a href="https://github.com/logos-co" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
        </header>

        <section aria-labelledby="main-heading" className="relative border-b border-white/10 py-4 text-center">
          <p className="absolute left-0 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-[0.18em] text-[#2FFBF7]">
            Context-grounded AI
          </p>
          <h1 id="main-heading" className="text-2xl font-bold leading-tight tracking-[0.04em] md:text-3xl">
            Logos Onboarding Assistant
          </h1>
          <p className="mx-auto mt-2 max-w-3xl text-sm leading-6 text-white/62">
            Ask about running nodes, LIPs, Cryptarchia consensus, Waku messaging, storage, the Logos Execution Zone, and
            project repositories with cited source links.
          </p>
        </section>

        <LogosChat />
      </section>
    </main>
  );
};

export default Page;
