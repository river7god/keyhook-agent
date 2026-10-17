import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './_lib/logout-button';
import { getCurrentUser } from './_lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Keyhook-agent',
  description: 'AI maintenance agent for NZ residential property managers',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en-NZ">
      <body>
        <nav className="nav" aria-label="Main">
          <strong>Keyhook-agent</strong>
          {user && (
            <>
              <Link href="/dashboard">Jobs</Link>
              <Link href="/dashboard/approvals">Approvals</Link>
              <Link href="/dashboard/audit">Audit log</Link>
              <Link href="/dashboard/feedback">Corrections</Link>
              <Link href="/simulator">Simulator</Link>
              <span style={{ flex: 1 }} />
              <span className="sub" style={{ margin: 0 }}>
                {user.name} · {user.organizationName}
              </span>
              <LogoutButton />
            </>
          )}
        </nav>
        {children}
      </body>
    </html>
  );
}
