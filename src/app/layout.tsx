import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Keyhook-agent',
  description: 'AI maintenance agent for NZ residential property managers',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ">
      <body>
        <nav className="nav" aria-label="Main">
          <strong>Keyhook-agent</strong>
          <Link href="/dashboard">Jobs</Link>
          <Link href="/dashboard/approvals">Approvals</Link>
          <Link href="/dashboard/audit">Audit log</Link>
          <Link href="/simulator">Simulator</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
