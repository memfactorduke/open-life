import { z } from 'zod';
import { TaskSchema, type Task } from './tasks.js';
import { TaskStepSchema, stepRollup, type TaskStep } from './steps.js';
import { SessionSchema } from './sessions.js';
import { FoodEntrySchema } from './food.js';
import { timeZoneSchema } from './foundation.js';
import type { AgentAttempt, AgentResult } from './agent-workflows.js';

export const AttentionRouteSchema = z.strictObject({
  kind: z.enum(['task', 'session', 'food']),
  id: z.uuid(),
});
export type AttentionRoute = z.infer<typeof AttentionRouteSchema>;
export const AttentionItemSchema = z.strictObject({
  id: z.string(),
  sourceId: z.uuid(),
  sourceRevision: z.number().int().positive(),
  kind: z.enum(['due', 'next', 'waiting', 'handoff', 'failure', 'outcome-unknown', 'review']),
  task: TaskSchema,
  step: TaskStepSchema.nullable(),
  waitingReason: z.string().nullable(),
  route: AttentionRouteSchema,
  dedupeKey: z.string(),
});
export const AttentionResponseSchema = z.strictObject({
  now: z.iso.datetime(),
  timezone: timeZoneSchema,
  date: z.iso.date(),
  items: z.array(AttentionItemSchema),
  activeSession: SessionSchema.nullable(),
  food: z.strictObject({
    entries: z.array(FoodEntrySchema),
    count: z.number().int().nonnegative(),
    route: z.literal('/food'),
  }),
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;
export type AttentionResponse = z.infer<typeof AttentionResponseSchema>;
export const NotificationPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  due: z.boolean(),
  handoff: z.boolean(),
  failure: z.boolean(),
});
export const NotificationPreferencesRecordSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  value: NotificationPreferencesSchema,
});
export const NotificationPreferencesCommandSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  value: NotificationPreferencesSchema,
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: false,
  due: false,
  handoff: false,
  failure: false,
};
export const NotificationDeviceSchema = z.strictObject({
  deviceId: z.uuid(),
  token: z.string().regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/),
  expectedPreferenceRevision: z.number().int().nonnegative(),
});
export function attentionDate(now: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}
/** Only these opaque routes are understood. Never follow arbitrary URLs from OS payloads. */
export function notificationRoute(data: unknown): AttentionRoute | null {
  const parsed = AttentionRouteSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
export function buildTaskAttention(
  tasks: Task[],
  steps: TaskStep[],
  attempts: AgentAttempt[],
  results: AgentResult[],
  now: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const task of tasks) {
    if (task.deletedAt || task.archivedAt || task.phase === 'completed' || task.schedule.skippedAt)
      continue;
    const live = steps.filter((s) => s.taskId === task.id && !s.deletedAt);
    const add = (
      kind: AttentionItem['kind'],
      sourceId: string,
      sourceRevision: number,
      step: TaskStep | null,
      waitingReason: string | null,
      identity = '',
    ) =>
      items.push({
        id: `${kind}:${sourceId}`,
        sourceId,
        sourceRevision,
        kind,
        task,
        step,
        waitingReason,
        route: { kind: 'task', id: task.id },
        dedupeKey: `${kind}:${kind === 'due' ? task.id : sourceId}:${identity || sourceRevision}`,
      });
    const due = !!task.schedule.dueAt && Date.parse(task.schedule.dueAt) <= Date.parse(now);
    const rollup = stepRollup(task, live);
    if (task.phase === 'planned') {
      if (due) add('waiting', task.id, task.revision, null, 'not_released');
    }
    if (task.paused) {
      add('waiting', task.id, task.revision, null, 'paused');
    }
    const blocked = task.phase === 'planned' || task.paused;
    if (!blocked && !live.length)
      add(due ? 'due' : 'next', task.id, task.revision, null, null, task.schedule.dueAt ?? 'next');
    for (const entry of blocked ? [] : rollup.entries) {
      const step = entry.step;
      if (['completed', 'skipped'].includes(step.status)) continue;
      if (entry.waitingReason) {
        add('waiting', step.id, step.revision, step, entry.waitingReason);
        continue;
      }
      const agentOwned = attempts.some(
        (a) =>
          a.stepId === step.id &&
          ['running', 'cancel-requested', 'outcome-unknown', 'submitted'].includes(a.status),
      );
      if (step.content.responsibility === 'agent' || agentOwned) {
        add('waiting', step.id, step.revision, step, 'agent');
        continue;
      }
      if (entry.ready || step.status === 'active') {
        const handoff = step.content.dependencies.some(
          (id) => live.find((s) => s.id === id)?.content.responsibility === 'agent',
        );
        add(
          due ? 'due' : handoff ? 'handoff' : 'next',
          step.id,
          step.revision,
          step,
          null,
          due ? task.schedule.dueAt! : String(step.executionRevision),
        );
      }
    }
    for (const attempt of attempts.filter((a) => a.taskId === task.id)) {
      const step = live.find((s) => s.id === attempt.stepId);
      if (!step) continue;
      const latest = attempts
        .filter((a) => a.stepId === step.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (latest?.id !== attempt.id) continue;
      const expired =
        ['running', 'cancel-requested'].includes(attempt.status) &&
        Date.parse(attempt.expiresAt) <= Date.parse(now);
      if (attempt.status === 'failed' && !['completed', 'skipped'].includes(step.status))
        add(
          'failure',
          attempt.id,
          attempt.revision,
          step,
          'agent_failed',
          String(attempt.revision),
        );
      else if (attempt.status === 'outcome-unknown' || expired)
        add(
          'outcome-unknown',
          attempt.id,
          attempt.revision,
          step,
          'reconcile_agent_outcome',
          String(attempt.revision),
        );
    }
    for (const result of results.filter(
      (r) =>
        r.taskId === task.id &&
        !r.approvedAt &&
        !r.feedback &&
        attempts.find((a) => a.id === r.attemptId)?.snapshot.binding.requiresApproval,
    )) {
      const step = live.find((s) => s.id === result.stepId);
      if (!step) continue;
      const latest = results
        .filter((r) => r.stepId === step.id)
        .sort((a, b) => b.version - a.version)[0];
      if (latest?.id === result.id)
        add('review', result.id, result.revision, step, 'review_result', String(result.version));
    }
    if (
      !blocked &&
      task.finalReviewRequired &&
      !task.finalReviewSatisfied &&
      rollup.canComplete === false &&
      live.every((s) => !s.content.required || s.status === 'completed')
    )
      add('review', task.id, task.revision, null, 'final_review');
  }
  const priority = { urgent: 0, high: 1, normal: 2, low: 3, none: 4 };
  return items.sort(
    (a, b) =>
      (a.kind === 'due' ? 0 : 1) - (b.kind === 'due' ? 0 : 1) ||
      priority[a.task.organization.priority] - priority[b.task.organization.priority] ||
      a.task.order - b.task.order ||
      (a.step?.content.order ?? 0) - (b.step?.content.order ?? 0) ||
      a.id.localeCompare(b.id),
  );
}
