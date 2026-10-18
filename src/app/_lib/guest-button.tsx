'use client';

import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** "Try it as a guest": signs in to the shared demo organization, then opens `next`. */
export function GuestButton({
  next = '/simulator',
  label = 'Try the live demo',
  className = 'button lg',
}: {
  next?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className={className}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void fetch('/api/v1/auth/guest', { method: 'POST' })
            .then(async (res) => {
              if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                  error?: { message?: string };
                };
                throw new Error(data.error?.message ?? `HTTP ${String(res.status)}`);
              }
              router.push(next);
              router.refresh();
            })
            .catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            });
        }}
      >
        {busy ? 'Opening demo…' : label} <ArrowRight size={18} />
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
