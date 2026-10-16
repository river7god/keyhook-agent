import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Keyhook-agent',
  description: 'AI maintenance agent for NZ residential property managers',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ">
      <body>{children}</body>
    </html>
  );
}
