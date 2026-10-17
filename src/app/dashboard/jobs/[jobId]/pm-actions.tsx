'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const URGENCIES = ['emergency', 'urgent', 'routine'] as const;
const TRADES = ['plumbing', 'electrical', 'heating', 'handyman', 'locksmith', 'other'] as const;
const TERMINAL = ['CLOSED', 'CANCELLED'];

interface Props {
  jobId: string;
  state: string;
  stateBeforeEscalation: string | null;
  urgency: string | null;
  trade: string | null;
  hasTenant: boolean;
  hasTradie: boolean;
}

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return data.error?.message ?? `HTTP ${res.status}`;
}

/** PM actions for one job, performed as the signed-in PM. */
export function PmActions(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [urgency, setUrgency] = useState(props.urgency ?? '');
  const [trade, setTrade] = useState(props.trade ?? '');
  const [recipient, setRecipient] = useState<'tenant' | 'tradie'>(
    props.hasTenant ? 'tenant' : 'tradie',
  );
  const [message, setMessage] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const run = async (fn: () => Promise<string | null>, reset?: () => void) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    reset?.();
    router.refresh();
  };

  const base = `/api/v1/jobs/${props.jobId}`;
  if (TERMINAL.includes(props.state)) return null;

  return (
    <div className="card">
      <h2>Actions</h2>

      {props.state === 'ESCALATED' && props.stateBeforeEscalation && (
        <form
          className="stack"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                post(`${base}/hand-back`, {
                  note: note.trim() || null,
                  urgency: urgency || null,
                  trade: trade || null,
                }),
              () => {
                setNote('');
              },
            );
          }}
        >
          <strong>
            Hand back to agent (resumes at {props.stateBeforeEscalation.replaceAll('_', ' ')})
          </strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={urgency}
              onChange={(e) => {
                setUrgency(e.target.value);
              }}
              aria-label="Urgency"
            >
              <option value="">urgency…</option>
              {URGENCIES.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <select
              value={trade}
              onChange={(e) => {
                setTrade(e.target.value);
              }}
              aria-label="Trade"
            >
              <option value="">trade…</option>
              {TRADES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <input
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            placeholder="What you resolved (optional)"
          />
          <button disabled={busy}>Hand back</button>
        </form>
      )}

      {(props.hasTenant || props.hasTradie) && (
        <form
          className="stack"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                post(`${base}/messages`, {
                  recipient,
                  body: message,
                  clientRequestId: crypto.randomUUID(),
                }),
              () => {
                setMessage('');
              },
            );
          }}
        >
          <strong>Message</strong>
          <select
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value as 'tenant' | 'tradie');
            }}
          >
            {props.hasTenant && <option value="tenant">Tenant</option>}
            {props.hasTradie && <option value="tradie">Tradie</option>}
          </select>
          <textarea
            rows={3}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
            }}
          />
          <button disabled={busy || !message.trim()}>Send as PM</button>
        </form>
      )}

      <form
        className="stack"
        style={{ marginTop: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => post(`${base}/cancel`, { reason: cancelReason }));
        }}
      >
        <strong>Cancel job</strong>
        <input
          value={cancelReason}
          onChange={(e) => {
            setCancelReason(e.target.value);
          }}
          placeholder="Reason (required)"
        />
        <button className="danger" disabled={busy || cancelReason.trim().length < 3}>
          Cancel job
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
