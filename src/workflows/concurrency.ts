/**
 * Every function that mutates a job shares this concurrency group (env scope), so one job is never
 * advanced by two runs at once — whether the trigger is a message, a PM decision or a follow-up.
 */
export const perJobConcurrency = {
  key: '"job-" + event.data.jobId',
  limit: 1,
  scope: 'env' as const,
};
