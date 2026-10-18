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
 * Open a case for each tenancy whose oldest unpaid rent is past the grace period. Returns the ids
 * of all open cases. In production the workflow then sends one advance event per case, so every
 * advance runs under the per-case concurrency key (never alongside a tenant reply).
 */
export async function openDueCases(
  deps: AgentDeps,
  organizationId: string,
): Promise<{ opened: number; openCaseIds: string[] }> {
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
  return { opened, openCaseIds: await listOpenCaseIds(deps.db, organizationId) };
}

/**
 * Open due cases and advance every open case in-process (evals, tests, scripts). One case
 * failing never stops the others.
 */
export async function sweepArrears(
  deps: AgentDeps,
  organizationId: string,
): Promise<{ opened: number; steps: Record<string, ArrearsStep | 'error'> }> {
  const { opened, openCaseIds } = await openDueCases(deps, organizationId);
  const steps: Record<string, ArrearsStep | 'error'> = {};
  for (const caseId of openCaseIds) {
    try {
      steps[caseId] = (await advanceArrears(deps, { organizationId, caseId })).step;
    } catch (err) {
      console.error('arrears advance failed', caseId, err);
      steps[caseId] = 'error';
    }
  }
  return { opened, steps };
}
