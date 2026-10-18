'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${String(res.status)}`);
  return data;
}

/** Queue the arrears sweep now; the page refreshes a few seconds later. */
export function RunCheck() {
  const router = useRouter();
  const [state, setState] = useState<string | null>(null);
  return (
    <span className="row">
      <button
        className="secondary"
        disabled={state === 'running'}
        onClick={() => {
          setState('running');
          void post('/api/v1/arrears/sweep')
            .then(() => {
              setState('Queued — the agent is checking balances…');
              setTimeout(() => {
                router.refresh();
                setState(null);
              }, 6000);
            })
            .catch((e: unknown) => {
              setState(e instanceof Error ? e.message : String(e));
            });
        }}
      >
        Run arrears check
      </button>
      {state && state !== 'running' && (
        <span className="sub" style={{ margin: 0 }}>
          {state}
        </span>
      )}
    </span>
  );
}

/** Record a payment (stands in for a matched bank-feed transaction). */
export function RecordPayment({
  caseId,
  suggestedCents,
}: {
  caseId: string;
  suggestedCents: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((suggestedCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row">
      <input
        aria-label="Payment amount (NZD)"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
        }}
        style={{ width: 110 }}
      />
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          const cents = Math.round(Number(amount) * 100);
          if (!Number.isFinite(cents) || cents <= 0) {
            setError('Enter an amount');
            return;
          }
          setBusy(true);
          setError(null);
          void post(`/api/v1/arrears/${caseId}/payments`, {
            amountCents: cents,
            reference: 'Recorded by PM',
          })
            .then(() => {
              setTimeout(() => {
                router.refresh();
                setBusy(false);
              }, 3000);
            })
            .catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            });
        }}
      >
        {busy ? 'Recording…' : 'Record payment'}
      </button>
      {error && <span className="error">{error}</span>}
    </span>
  );
}
