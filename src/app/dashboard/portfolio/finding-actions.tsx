'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    jobId?: string;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

/** Open a finding as a job, or dismiss it — the PM decides, never the monitor. */
export function FindingActions({ findingId }: { findingId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (kind: 'open' | 'dismiss') => {
    setBusy(true);
    setError(null);
    try {
      const data = await post(`/api/v1/monitor-findings/${findingId}/${kind}`, {
        note: note.trim() || null,
      });
      if (kind === 'open' && data.jobId) router.push(`/dashboard/jobs/${data.jobId}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <input
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy} onClick={() => void act('open')}>
          Open job
        </button>
        <button className="secondary" disabled={busy} onClick={() => void act('dismiss')}>
          Dismiss
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function ScanNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <span>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void post('/api/v1/monitor-findings/scan')
            .then((r) => {
              const { created = 0, updated = 0 } = r as { created?: number; updated?: number };
              setResult(`${created} new, ${updated} updated`);
              router.refresh();
            })
            .catch((e: unknown) => {
              setResult(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? 'Scanning…' : 'Scan now'}
      </button>{' '}
      {result && <span className="sub">{result}</span>}
    </span>
  );
}
