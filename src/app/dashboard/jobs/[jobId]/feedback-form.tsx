'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const KINDS = [
  ['urgency', 'Urgency was wrong'],
  ['trade', 'Trade was wrong'],
  ['should_have_escalated', 'Should have escalated to me'],
  ['should_not_have_escalated', 'Should not have escalated'],
  ['other', 'Something else'],
] as const;

/** "The agent got this wrong" — becomes a labelled example for the eval suite. */
export function FeedbackForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('urgency');
  const [urgency, setUrgency] = useState('');
  const [trade, setTrade] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <button
        className="secondary"
        onClick={() => {
          setOpen(true);
          setDone(false);
        }}
      >
        {done ? 'Thanks — flag another issue' : 'Flag an agent mistake'}
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/jobs/${jobId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind,
        expectedUrgency: kind === 'urgency' ? urgency || null : null,
        expectedTrade: kind === 'trade' ? trade || null : null,
        note: note.trim() || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(data.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    setOpen(false);
    setDone(true);
    setNote('');
    router.refresh();
  };

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <strong>What did the agent get wrong?</strong>
      <select
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as typeof kind);
        }}
      >
        {KINDS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      {kind === 'urgency' && (
        <select
          value={urgency}
          onChange={(e) => {
            setUrgency(e.target.value);
          }}
          required
        >
          <option value="">Correct urgency…</option>
          <option>emergency</option>
          <option>urgent</option>
          <option>routine</option>
        </select>
      )}
      {kind === 'trade' && (
        <select
          value={trade}
          onChange={(e) => {
            setTrade(e.target.value);
          }}
          required
        >
          <option value="">Correct trade…</option>
          {['plumbing', 'electrical', 'heating', 'handyman', 'locksmith', 'other'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      )}
      <textarea
        rows={2}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        placeholder={kind === 'other' ? 'Describe what went wrong (required)' : 'Note (optional)'}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy}>Save</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
