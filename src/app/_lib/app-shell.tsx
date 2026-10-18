import { and, count, eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { approvals, monitorFindings } from '@/db/schema';
import { stateCounts } from '@/domain/dashboard';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
import { getCurrentUser } from './session';
import { SidebarNav, type NavCounts } from './sidebar-nav';

async function navCounts(organizationId: string): Promise<NavCounts> {
  return withOrg(getDb(), organizationId, async (tx) => {
    const [states, [a], [f]] = await Promise.all([
      stateCounts(tx, organizationId),
      tx
        .select({ n: count() })
        .from(approvals)
        .where(and(eq(approvals.organizationId, organizationId), eq(approvals.status, 'pending'))),
      tx
        .select({ n: count() })
        .from(monitorFindings)
        .where(
          and(
            eq(monitorFindings.organizationId, organizationId),
            eq(monitorFindings.status, 'open'),
          ),
        ),
    ]);
    return { needsPm: states.needs_pm, approvals: a?.n ?? 0, findings: f?.n ?? 0 };
  });
}

/** Signed-in product chrome: sidebar navigation, organization, user. */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  // Pages redirect to /login themselves; render bare content until they do.
  if (!user) return <>{children}</>;
  const counts = await navCounts(user.organizationId);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <Brand href="/dashboard" tagline />
        <SidebarNav counts={counts} />
        <div className="footer">
          <div className="who">{user.name}</div>
          <div className="sub" style={{ margin: '0 0 10px' }}>
            {user.organizationName}
          </div>
          <LogoutButton />
        </div>
      </aside>
      <div className="main">
        <nav className="mobile-nav" aria-label="Main">
          <SidebarNav counts={counts} compact />
        </nav>
        {children}
      </div>
    </div>
  );
}
