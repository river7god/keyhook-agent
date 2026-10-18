'use client';

import { ImagePlus } from 'lucide-react';
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
    <div className="sim">
      <section className="card stack">
        <div className="segmented" role="radiogroup" aria-label="Act as">
          {(['tenant', 'tradie'] as const).map((t) => (
            <label key={t} className={senderType === t ? 'on' : undefined}>
              <input
                type="radio"
                checked={senderType === t}
                onChange={() => {
                  switchSender(t);
                }}
              />
              {t === 'tenant' ? 'Tenant' : 'Supplier'}
            </label>
          ))}
        </div>
        <label className="field">
          <span>{senderType === 'tenant' ? 'Tenant' : 'Supplier'}</span>
          <select
            value={senderId}
            onChange={(e) => {
              setSenderId(e.target.value);
              setJobId(null);
            }}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {'address' in p
                  ? `${p.name} — ${p.address}, ${p.suburb}${p.language !== 'en' ? ` (${p.language})` : ''}`
                  : p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Work order</span>
          <select
            value={jobId ?? ''}
            onChange={(e) => {
              setJobId(e.target.value || null);
            }}
          >
            {senderType === 'tenant' && <option value="">+ Report a new issue</option>}
            {senderType === 'tradie' && openJobs.length === 0 && (
              <option value="">(no jobs assigned)</option>
            )}
            {openJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} — {j.state}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Message</span>
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
          />
        </label>
        <label className="file-pick">
          <ImagePlus size={16} />
          {photos.length
            ? `${photos.length} photo${photos.length > 1 ? 's' : ''} attached`
            : 'Add photos'}
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
          <div className="thumbs">
            {photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- local data: preview
              <img key={p.name} src={`data:image/jpeg;base64,${p.b64}`} alt={p.name} />
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
        >
          {sending ? 'Sending…' : 'Send message'}
        </button>
        {error && <p className="error">{error}</p>}
        {notice && <p style={{ color: 'var(--warn)' }}>{notice}</p>}
      </section>

      <section className="card">
        {!shown ? (
          pending ? (
            <ol className="thread">
              <li className="bubble in pending-msg">{pending.body}</li>
              <li>
                <AgentActivityBadge
                  activity={{
                    working: true,
                    waitingSince: pending.at,
                    lastStep: null,
                    stalled: false,
                  }}
                />
              </li>
            </ol>
          ) : (
            <p className="sub" style={{ margin: 0 }}>
              Send a message or pick a work order to see the conversation.
            </p>
          )
        ) : (
          <>
            <h2>
              {shown.job.title}
              <span className="spacer" />
              <span className={`badge ${shown.job.state}`}>
                {shown.job.state.replaceAll('_', ' ')}
              </span>
            </h2>
            <div className="row sub" style={{ marginBottom: 14 }}>
              {shown.job.urgency && (
                <span className={`badge ${shown.job.urgency}`}>{shown.job.urgency}</span>
              )}
              {shown.job.trade && <span className="chip">{shown.job.trade}</span>}
              {shown.job.estimateCents !== null && (
                <span className="chip">${(shown.job.estimateCents / 100).toFixed(2)}</span>
              )}
              {shown.job.scheduledStart && (
                <span className="chip">visit {nz(shown.job.scheduledStart)}</span>
              )}
              {shown.llmCostUsdMicros > 0 && (
                <span className="chip">
                  AI cost US${(shown.llmCostUsdMicros / 1_000_000).toFixed(4)}
                </span>
              )}
            </div>
            <ol className="thread">
              {shown.messages.map((m) => (
                <li
                  key={m.id}
                  className={`bubble ${m.direction === 'inbound' ? 'in' : `out ${m.recipientType}`}`}
                >
                  <span className="who">
                    {m.direction === 'inbound'
                      ? `${m.senderType === 'tradie' ? 'supplier' : m.senderType} → agent`
                      : `agent → ${m.recipientType === 'tradie' ? 'supplier' : m.recipientType}`}{' '}
                    · {nz(m.createdAt)}
                  </span>
                  {m.body}
                  {shown.media
                    .filter((p) => p.messageId === m.id)
                    .map((p) => (
                      <figure key={p.id} style={{ margin: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
                        <img src={`/api/v1/media/${p.id}`} alt="Attached photo" />
                        <figcaption>
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
                <li className="bubble in pending-msg">
                  <span className="who">{senderType} → agent · sending…</span>
                  {pending.body}
                </li>
              )}
              <li>
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
            <details style={{ marginTop: 16 }}>
              <summary className="sub">Audit trail ({shown.audit.length})</summary>
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
