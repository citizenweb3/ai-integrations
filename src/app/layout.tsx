import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Agents as a Service | Citizen Web3',
  description:
    'We don\'t build chatbots. We build entire autonomous AI workforces. Tailored automation for your business by Citizen Web3.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script defer data-domain="agents.citizenweb3.com" src="https://plausible.io/js/script.js"></script>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="robots" content="index,follow" />
        <meta
          name="keywords"
          content="AI agents, autonomous workforce, AI automation, Web3 AI, Citizen Web3, AI as a service, custom AI agents, agent development, AI tools"
        />

        <meta property="og:type" content="website" />
        <meta property="og:title" content="AI Agents as a Service | Citizen Web3" />
        <meta
          property="og:description"
          content="We don't build chatbots. We build entire autonomous AI workforces. Tailored automation for your business by Citizen Web3."
        />
        <meta property="og:image" content="https://agents.citizenweb3.com/cw3logo.png" />
        <meta property="og:url" content="https://agents.citizenweb3.com" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="AI Agents as a Service | Citizen Web3" />
        <meta
          name="twitter:description"
          content="We don't build chatbots. We build entire autonomous AI workforces. Tailored automation for your business by Citizen Web3."
        />
        <meta name="twitter:image" content="https://agents.citizenweb3.com/cw3logo.png" />
        <meta name="twitter:url" content="https://agents.citizenweb3.com" />

        <link rel="canonical" href="https://agents.citizenweb3.com/" />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
