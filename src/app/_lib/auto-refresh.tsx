'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-render the server component every `ms` while `active` (e.g. while the agent is working). */
export function AutoRefresh({ active, ms = 5000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      router.refresh();
    }, ms);
    return () => {
      clearInterval(t);
    };
  }, [active, ms, router]);
  return null;
}
