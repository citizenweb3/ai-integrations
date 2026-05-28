import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = {
  title: "BizDev Outreach · Operator Console",
  description: "Zero-autosend outreach console. Postgres-coordinated commands, jobs, events."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className={inter.className}>
        <main className="min-h-dvh">{children}</main>
      </body>
    </html>
  );
}
