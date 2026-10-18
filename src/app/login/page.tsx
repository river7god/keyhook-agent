import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Brand } from '@/app/_lib/brand';
import { GuestButton } from '@/app/_lib/guest-button';
import { guestLoginEnabled } from '@/domain/auth';
import { getCurrentUser } from '@/app/_lib/session';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/** Only same-site relative paths are allowed as a post-login destination (no open redirect). */
const nextPath = z
  .string()
  .regex(/^\/(?!\/)[\w\-/?=&%.]*$/)
  .catch('/dashboard');

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = nextPath.parse((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <Brand tagline />
        <h1>Sign in</h1>
        <p className="sub">Property manager access to work orders, approvals and agents.</p>
        <LoginForm next={next} />
        {guestLoginEnabled() && (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="sub" style={{ margin: 0, textAlign: 'center' }}>
              or
            </div>
            <GuestButton
              next={next === '/dashboard' ? '/simulator' : next}
              label="Continue as guest reviewer"
              className="button secondary"
            />
          </div>
        )}
        {process.env.NODE_ENV !== 'production' ? (
          <p className="sub" style={{ margin: '16px 0 0', fontSize: '0.85rem' }}>
            Dev seed: aroha@harbourcity.example.test / keyhook-demo
          </p>
        ) : (
          <p className="sub" style={{ margin: '16px 0 0', fontSize: '0.85rem' }}>
            {guestLoginEnabled()
              ? 'Reviewer accounts share one demo agency.'
              : 'Demo access is available on request.'}
          </p>
        )}
      </div>
    </main>
  );
}
