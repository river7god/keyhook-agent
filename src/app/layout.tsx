import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'Keyhook-agent — AI agents for property managers',
    template: '%s · Keyhook-agent',
  },
  description:
    'AI agents that run New Zealand rental maintenance from the tenant’s first message to a closed work order, with a property manager in charge.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
