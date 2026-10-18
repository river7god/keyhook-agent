'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function InspectionForm({ properties }: { properties: { id: string; label: string }[] }) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/inspection-findings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId, notes: notes.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      jobId?: string;
      error?: { message?: string };
    };
    setBusy(false);
    if (!res.ok || !data.jobId) {
      setError(data.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    router.push(`/dashboard/jobs/${data.jobId}`);
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label>
        Property{' '}
        <select
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
          }}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <textarea
        rows={4}
        placeholder="e.g. Bathroom extractor fan not working; mould starting on ceiling above shower."
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
      <div>
        <button disabled={busy || notes.trim().length < 10} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Create work order'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
