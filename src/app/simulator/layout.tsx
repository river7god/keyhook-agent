import type { ReactNode } from 'react';
import { AppShell } from '@/app/_lib/app-shell';

export default function SimulatorLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
