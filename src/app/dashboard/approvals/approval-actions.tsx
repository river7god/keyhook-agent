'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApprovalActions({
  approvalId,
  pms,
}: {
  approvalId: string;
  pms: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pmId, setPmId] = useState(pms[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, propertyManagerId: pmId, note: note.trim() || null }),
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
      <select
        value={pmId}
        onChange={(e) => {
          setPmId(e.target.value);
        }}
        aria-label="Deciding PM"
      >
        {pms.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
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
