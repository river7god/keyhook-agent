'use client';

import { useEffect, useState } from 'react';

export interface ActivityView {
  working: boolean;
  waitingSince: string | null;
  lastStep: string | null;
  stalled: boolean;
}

function elapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Agent is working…" bubble with a live timer; warns when nothing has happened for a while. */
export function AgentActivityBadge({ activity }: { activity: ActivityView | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activity?.working) return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [activity?.working]);

  if (!activity?.working) return null;
  const since = activity.waitingSince ? elapsed(activity.waitingSince, now) : null;
  return (
    <div
      className={`agent-typing${activity.stalled ? ' stalled' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        {activity.stalled
          ? 'Taking longer than usual — the background worker may not be responding'
          : 'Agent is working…'}
        {since && ` ${since}`}
        {activity.lastStep && ` · last: ${activity.lastStep}`}
      </span>
    </div>
  );
}
