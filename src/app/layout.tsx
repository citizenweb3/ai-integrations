import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_URL ?? 'http://localhost:3010'),
  title: {
    default: 'Logos Onboarding Chatbot',
    template: '%s',
  },
  description: 'Context-grounded onboarding assistant for the Logos network.',
  icons: {
    icon: '/favicon.svg',
  },
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${inter.className}`}>{children}</body>
    </html>
  );
};

export default RootLayout;
