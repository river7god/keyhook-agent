'use client';

import { useEffect, useState } from 'react';
import { AgentActivityBadge, type ActivityView } from '../_lib/agent-activity-badge';
import { downscaleToBase64 } from '../_lib/downscale';

interface Persona {
  id: string;
  name: string;
}
interface Props {
  personas: {
    tenants: (Persona & { language: string; address: string; suburb: string })[];
    tradies: (Persona & { trades: string[] })[];
  };
}
interface JobSummary {
  id: string;
  title: string;
  state: string;
}
interface Snapshot {
  job: {
    id: string;
    title: string;
    state: string;
    urgency: string | null;
    trade: string | null;
    estimateCents: number | null;
    scheduledStart: string | null;
  };
  messages: {
    id: string;
    direction: 'inbound' | 'outbound';
    senderType: string;
    recipientType: string;
    body: string;
    status: string;
    createdAt: string;
  }[];
  audit: {
    id: number;
    action: string;
    reason: string | null;
    outcome: string;
    createdAt: string;
  }[];
  activity: ActivityView;
  media: {
    id: string;
    messageId: string;
    analysis:
      | {
          quality: string;
          showsIssue: boolean;
          observations: string;
          label: { make: string | null; model: string | null; serial: string | null } | null;
        }
      | { unavailable: string }
      | null;
  }[];
  llmCostUsdMicros: number;
}

const nz = (iso: string) =>
  new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

export function Simulator({ personas }: Props) {
  const [senderType, setSenderType] = useState<'tenant' | 'tradie'>('tenant');
  const [senderId, setSenderId] = useState(personas.tenants[0]?.id ?? '');
  const [openJobs, setOpenJobs] = useState<JobSummary[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ name: string; b64: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** Shown immediately on send, until the next snapshot includes the real message. */
  const [pending, setPending] = useState<{ body: string; at: string } | null>(null);
  const [refresh, setRefresh] = useState(0);

  // Bumped after each send so the open-jobs list refetches.
  const [jobsVersion, setJobsVersion] = useState(0);

  useEffect(() => {
    if (!senderId) return;
    let cancelled = false;
    void fetch(`/api/v1/simulator/jobs/open?senderType=${senderType}&senderId=${senderId}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ jobs: JobSummary[] }>) : null))
      .then((data) => {
        if (data && !cancelled) setOpenJobs(data.jobs);
      });
    return () => {
      cancelled = true;
    };
  }, [senderType, senderId, jobsVersion]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = () =>
      fetch(`/api/v1/simulator/jobs/${jobId}`)
        .then((res) => (res.ok ? (res.json() as Promise<Snapshot>) : null))
        .then((data) => {
          if (data && !cancelled) setSnapshot(data);
        });
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, refresh]);

  // Only show a snapshot for the currently selected job.
  const shown = snapshot && snapshot.job.id === jobId ? snapshot : null;

  const switchSender = (type: 'tenant' | 'tradie') => {
    setSenderType(type);
    setSenderId((type === 'tenant' ? personas.tenants[0]?.id : personas.tradies[0]?.id) ?? '');
    setJobId(null);
  };

  const send = async () => {
    setSending(true);
    setError(null);
    setPending({ body: text, at: new Date().toISOString() });
    try {
      const res = await fetch('/api/v1/simulator/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          senderType,
          senderId,
          jobId,
          body: text,
          images: photos.map((p) => p.b64),
        }),
      });
      const data = (await res.json()) as {
        jobId?: string;
        images?: { rejected: { index: number; reason: string }[] };
        error?: { message: string };
      };
      if (!res.ok || !data.jobId) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      const rejected = data.images?.rejected ?? [];
      setNotice(
        rejected.length ? `Photo not accepted: ${rejected.map((r) => r.reason).join('; ')}` : null,
      );
      setText('');
      setPhotos([]);
      setJobId(data.jobId);
      setJobsVersion((v) => v + 1);
      setRefresh((v) => v + 1); // fetch the snapshot now, not on the next 2s tick
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      setPending(null);
    }
  };

  const people = senderType === 'tenant' ? personas.tenants : personas.tradies;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: '1.5rem' }}>
      <section>
        <fieldset style={{ border: 'none', padding: 0 }}>
          <legend style={{ fontWeight: 600 }}>Act as</legend>
          {(['tenant', 'tradie'] as const).map((t) => (
            <label key={t} style={{ marginRight: 12 }}>
              <input
                type="radio"
                checked={senderType === t}
                onChange={() => {
                  switchSender(t);
                }}
              />{' '}
              {t}
            </label>
          ))}
        </fieldset>
        <select
          value={senderId}
          onChange={(e) => {
            setSenderId(e.target.value);
            setJobId(null);
          }}
          style={{ width: '100%', margin: '8px 0', padding: 6 }}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {'address' in p
                ? `${p.name} — ${p.address}, ${p.suburb}${p.language !== 'en' ? ` (${p.language})` : ''}`
                : p.name}
            </option>
          ))}
        </select>

        <label style={{ display: 'block', fontWeight: 600, marginTop: 8 }}>Job</label>
        <select
          value={jobId ?? ''}
          onChange={(e) => {
            setJobId(e.target.value || null);
          }}
          style={{ width: '100%', margin: '8px 0', padding: 6 }}
        >
          {senderType === 'tenant' && <option value="">➕ Report a new issue</option>}
          {senderType === 'tradie' && openJobs.length === 0 && (
            <option value="">(no jobs assigned)</option>
          )}
          {openJobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} — {j.state}
            </option>
          ))}
        </select>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          rows={5}
          placeholder={
            senderType === 'tenant'
              ? 'e.g. There is no hot water since this morning'
              : 'e.g. I can do it for $220 incl GST'
          }
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
        <label style={{ display: 'block', marginTop: 8 }}>
          Photos{' '}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).slice(0, 5);
              void Promise.all(
                files.map(async (f) => ({ name: f.name, b64: await downscaleToBase64(f) })),
              )
                .then(setPhotos)
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : String(err));
                });
            }}
          />
        </label>
        {photos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- local data: preview
              <img
                key={p.name}
                src={`data:image/jpeg;base64,${p.b64}`}
                alt={p.name}
                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }}
              />
            ))}
          </div>
        )}
        <button
          onClick={() => void send()}
          disabled={
            sending ||
            (!text.trim() && photos.length === 0) ||
            !senderId ||
            (senderType === 'tradie' && !jobId)
          }
          style={{ marginTop: 8, padding: '8px 16px' }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        {error && <p style={{ color: '#b00020' }}>{error}</p>}
        {notice && <p style={{ color: '#9a6200' }}>{notice}</p>}
      </section>

      <section>
        {!shown ? (
          pending ? (
            <div>
              <p
                className="pending-msg"
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: '#eef3ff',
                  marginRight: '15%',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {pending.body}
              </p>
              <AgentActivityBadge
                activity={{
                  working: true,
                  waitingSince: pending.at,
                  lastStep: null,
                  stalled: false,
                }}
              />
            </div>
          ) : (
            <p style={{ color: '#777' }}>Send a message or pick a job to see the conversation.</p>
          )
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>{shown.job.title}</h2>
            <p>
              <strong>{shown.job.state}</strong>
              {shown.job.urgency && ` · ${shown.job.urgency}`}
              {shown.job.trade && ` · ${shown.job.trade}`}
              {shown.job.estimateCents !== null &&
                ` · $${(shown.job.estimateCents / 100).toFixed(2)}`}
              {shown.job.scheduledStart && ` · visit ${nz(shown.job.scheduledStart)}`}
              {` · LLM cost US$${(shown.llmCostUsdMicros / 1_000_000).toFixed(4)}`}
            </p>
            <ol style={{ listStyle: 'none', padding: 0 }}>
              {shown.messages.map((m) => (
                <li
                  key={m.id}
                  style={{
                    margin: '8px 0',
                    padding: 10,
                    borderRadius: 8,
                    background:
                      m.direction === 'inbound'
                        ? '#eef3ff'
                        : m.recipientType === 'pm'
                          ? '#fff3e0'
                          : '#f1f8e9',
                    marginLeft: m.direction === 'inbound' ? 0 : '15%',
                    marginRight: m.direction === 'inbound' ? '15%' : 0,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <small style={{ color: '#555' }}>
                    {m.direction === 'inbound'
                      ? `${m.senderType} → agent`
                      : `agent → ${m.recipientType}`}{' '}
                    · {nz(m.createdAt)}
                  </small>
                  <div>{m.body}</div>
                  {shown.media
                    .filter((p) => p.messageId === m.id)
                    .map((p) => (
                      <figure key={p.id} style={{ margin: '8px 0 0' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
                        <img
                          src={`/api/v1/media/${p.id}`}
                          alt="Attached photo"
                          style={{ maxWidth: 220, borderRadius: 6 }}
                        />
                        <figcaption style={{ fontSize: 12, color: '#555' }}>
                          {!p.analysis
                            ? 'Analysing photo…'
                            : 'unavailable' in p.analysis
                              ? 'Photo kept — not analysed (no vision model)'
                              : `${p.analysis.quality}${p.analysis.showsIssue ? '' : ' · does not show the issue'} — ${p.analysis.observations}${
                                  p.analysis.label?.model
                                    ? ` · ${[p.analysis.label.make, p.analysis.label.model].filter(Boolean).join(' ')}`
                                    : ''
                                }`}
                        </figcaption>
                      </figure>
                    ))}
                </li>
              ))}
              {pending && (
                <li
                  className="pending-msg"
                  style={{
                    margin: '8px 0',
                    padding: 10,
                    borderRadius: 8,
                    background: '#eef3ff',
                    marginRight: '15%',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <small style={{ color: '#555' }}>{senderType} → agent · sending…</small>
                  <div>{pending.body}</div>
                </li>
              )}
              <li style={{ margin: '8px 0' }}>
                <AgentActivityBadge
                  activity={
                    sending
                      ? {
                          working: true,
                          waitingSince: pending?.at ?? null,
                          lastStep: null,
                          stalled: false,
                        }
                      : shown.activity
                  }
                />
              </li>
            </ol>
            <details>
              <summary>Audit trail ({shown.audit.length})</summary>
              <ul style={{ fontSize: 13 }}>
                {shown.audit.map((a) => (
                  <li key={a.id}>
                    {nz(a.createdAt)} · <code>{a.action}</code> · {a.outcome}
                    {a.reason && ` — ${a.reason}`}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
