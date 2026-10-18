import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Brand } from '@/app/_lib/brand';
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
        {process.env.NODE_ENV !== 'production' ? (
          <p className="sub" style={{ margin: '16px 0 0', fontSize: '0.85rem' }}>
            Dev seed: aroha@harbourcity.example.test / keyhook-demo
          </p>
        ) : (
          <p className="sub" style={{ margin: '16px 0 0', fontSize: '0.85rem' }}>
            Demo access is available on request.
          </p>
        )}
      </div>
    </main>
  );
}
