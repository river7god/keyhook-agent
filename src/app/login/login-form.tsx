'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(data.error?.message ?? 'Sign-in failed');
      return;
    }
    router.replace(next);
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
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          required
          style={{ width: '100%' }}
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          required
          style={{ width: '100%' }}
        />
      </label>
      <button disabled={busy} style={{ marginTop: 6 }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
