'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, note: note.trim() || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: { message: string } };
      setError(data.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        placeholder="Note (optional)"
      />
      <button disabled={busy} onClick={() => void decide('approved')}>
        Approve
      </button>
      <button disabled={busy} onClick={() => void decide('rejected')}>
        Reject
      </button>
      {error && <span style={{ color: '#b00020' }}>{error}</span>}
    </div>
  );
}
