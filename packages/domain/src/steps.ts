import { z } from 'zod';
import type { Task } from './tasks.js';
export const StepContentSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  instructions: z.string().max(20000),
  responsibility: z.enum(['human', 'agent', 'either']),
  required: z.boolean(),
  dependencies: z.array(z.uuid()).max(100),
  order: z.number().int().nonnegative(),
});
export const TaskStepSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  revision: z.number().int().positive(),
  executionRevision: z.number().int().positive().default(1),
  content: StepContentSchema,
  status: z.enum(['pending', 'active', 'completed', 'skipped']),
  assignedTo: z.string().max(200).nullable(),
  deletedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const base = {
  operationId: z.uuid(),
  taskId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  expectedTaskRevision: z.number().int().positive(),
};
export const StepCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('step.create'),
    expectedRevision: z.literal(0),
    content: StepContentSchema,
  }),
  z.strictObject({ ...base, type: z.literal('step.edit'), content: StepContentSchema }),
  z.strictObject({
    ...base,
    type: z.literal('step.status'),
    status: z.enum(['pending', 'active', 'completed', 'skipped']),
  }),
  z.strictObject({
    ...base,
    type: z.literal('step.assign'),
    assignedTo: z.string().min(1).max(200).nullable(),
  }),
  z.strictObject({ ...base, type: z.literal('step.delete') }),
]);
export type TaskStep = z.infer<typeof TaskStepSchema>;
export type StepCommand = z.infer<typeof StepCommandSchema>;
export function validateStepGraph(steps: TaskStep[]): void {
  if (new Set(steps.map((step) => step.id)).size !== steps.length)
    throw new Error('Step identities must be unique.');
  if (new Set(steps.map((step) => step.taskId)).size > 1)
    throw new Error('Dependencies must belong to this parent task.');
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error('Dependencies must not form a cycle.');
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step || step.deletedAt)
      throw new Error('Dependencies must belong to a live step in this parent task.');
    visiting.add(id);
    for (const dependency of step.content.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const step of steps.filter((step) => !step.deletedAt)) {
    if (new Set(step.content.dependencies).size !== step.content.dependencies.length)
      throw new Error('Dependencies must be unique.');
    visit(step.id);
  }
}
export function stepRollup(task: Task, steps: TaskStep[]) {
  steps = steps.filter((step) => step.taskId === task.id && !step.deletedAt);
  const satisfied = (id: string) => {
    const step = steps.find((s) => s.id === id);
    return (
      !!step &&
      (step.status === 'completed' || (!step.content.required && step.status === 'skipped'))
    );
  };
  const entries = steps.map((step) => {
    const waitingReason =
      task.deletedAt || task.archivedAt || task.phase === 'completed'
        ? 'parent_closed'
        : task.phase === 'planned'
          ? 'not_released'
          : task.paused
            ? 'paused'
            : !step.content.dependencies.every(satisfied)
              ? 'dependencies'
              : null;
    return { step, ready: step.status === 'pending' && waitingReason === null, waitingReason };
  });
  return {
    entries,
    nextActions: entries.filter((e) => e.ready).map((e) => e.step.id),
    canComplete:
      steps.filter((s) => s.content.required).every((s) => s.status === 'completed') &&
      (!task.finalReviewRequired || task.finalReviewSatisfied),
  };
}
