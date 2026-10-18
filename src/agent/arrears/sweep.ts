import {
  findOpenCase,
  ledgerPosition,
  listOpenCaseIds,
  openCase,
  tenanciesWithRent,
} from '@/domain/arrears';
import { loadWorkflowPolicy } from '@/domain/follow-ups';
import { nzDate } from '@/lib/time';
import type { AgentDeps } from '../handlers/shared';
import { advanceArrears, type ArrearsStep } from './advance';

/**
 * Daily arrears sweep for one organization (spec §12 R8): open a case for each tenancy whose
 * oldest unpaid rent is past the grace period, then advance every open case by the time rules.
 * One case failing never stops the others.
 */
export async function sweepArrears(
  deps: AgentDeps,
  organizationId: string,
): Promise<{ opened: number; steps: Record<string, ArrearsStep | 'error'> }> {
  const today = nzDate(deps.now());
  const policy = (await loadWorkflowPolicy(deps.db, organizationId)).arrears;
  let opened = 0;
  for (const t of await tenanciesWithRent(deps.db, organizationId)) {
    if (await findOpenCase(deps.db, organizationId, { tenancyId: t.tenancyId })) continue;
    const pos = await ledgerPosition(deps.db, organizationId, t.tenancyId, today);
    if (pos.daysOverdue <= policy.graceDays) continue;
    const c = await deps.db.transaction((tx) =>
      openCase(tx, { organizationId, tenancyId: t.tenancyId, tenantId: t.tenantId, position: pos }),
    );
    if (c) opened++;
  }
  const steps: Record<string, ArrearsStep | 'error'> = {};
  for (const caseId of await listOpenCaseIds(deps.db, organizationId)) {
    try {
      steps[caseId] = (await advanceArrears(deps, { organizationId, caseId })).step;
    } catch (err) {
      console.error('arrears advance failed', caseId, err);
      steps[caseId] = 'error';
    }
  }
  return { opened, steps };
}
