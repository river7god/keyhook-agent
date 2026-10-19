'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Status {
  lastAt?: string | null;
  error?: { message?: string };
}

async function call(method: 'GET' | 'POST'): Promise<Status> {
  const res = await fetch('/api/v1/ops/analyze', { method });
  const data = (await res.json().catch(() => ({}))) as Status;
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${String(res.status)}`);
  return data;
}

/** Queue the Ops analyst, then refresh once its new brief has been written. */
export function RunAnalysis() {
  const router = useRouter();
  const [state, setState] = useState<string | null>(null);
  return (
    <span className="row">
      <button
        className="secondary"
        disabled={state !== null && state !== 'done'}
        onClick={() => {
          setState('Queued — the Ops analyst is reading this month’s usage…');
          void call('POST')
            .then(async ({ lastAt }) => {
              for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 3000));
                const now = await call('GET');
                if (now.lastAt && now.lastAt !== lastAt) break;
              }
              router.refresh();
              setState(null);
            })
            .catch((e: unknown) => {
              setState(e instanceof Error ? e.message : String(e));
            });
        }}
      >
        Run analysis now
      </button>
      {state && (
        <span className="sub" style={{ margin: 0 }}>
          {state}
        </span>
      )}
    </span>
  );
}
