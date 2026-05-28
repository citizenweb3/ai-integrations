import type { ReactNode } from "react";
import { Instrument_Serif, JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// Three-font system for the operator console:
// - Instrument Serif (display) — characterful editorial headings.
// - JetBrains Mono — identifiers, counts, status codes (terminal feel matches
//   the system's command/job/event vocabulary).
// - Public Sans — body copy. Avoids the Inter/Geist default-AI look.
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap"
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});
const body = Public_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap"
});

export const metadata = {
  title: "BizDev Outreach · Operator Console",
  description: "Zero-autosend outreach console. Postgres-coordinated commands, jobs, events."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${display.variable} ${mono.variable} ${body.variable}`}
    >
      <body>
        <main className="min-h-dvh">{children}</main>
      </body>
    </html>
  );
}
