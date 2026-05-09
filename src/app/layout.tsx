import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Logos Chatbot',
  description: 'Onboarding assistant for the Logos network.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
