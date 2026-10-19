import { approveSpendTool, approveVariationTool, requestApprovalTool } from './approval-tools';
import {
  addNoteTool,
  escalateTool,
  requestQuoteTool,
  scheduleVisitTool,
  sendMessageTool,
} from './action-tools';
import {
  escalateArrearsTool,
  recordPromiseTool,
  requestNoticeApprovalTool,
  sendArrearsMessageTool,
  sendArrearsNoticeTool,
} from './arrears-tools';
import { getPropertyTool, listJobsForPropertyTool, searchTradiesTool } from './read-tools';
import type { AnyTool } from './types';

/** Every tool the agents can call (maintenance + arrears). */
export const ALL_TOOLS: readonly AnyTool[] = [
  getPropertyTool,
  listJobsForPropertyTool,
  searchTradiesTool,
  sendMessageTool,
  requestQuoteTool,
  scheduleVisitTool,
  escalateTool,
  addNoteTool,
  requestApprovalTool,
  approveSpendTool,
  approveVariationTool,
  sendArrearsMessageTool,
  recordPromiseTool,
  requestNoticeApprovalTool,
  sendArrearsNoticeTool,
  escalateArrearsTool,
];

export const TOOL_NAMES: ReadonlySet<string> = new Set(ALL_TOOLS.map((t) => t.name));
export const toolPermission = (name: string) => ALL_TOOLS.find((t) => t.name === name)?.permission;
