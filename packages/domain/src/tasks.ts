import { z } from 'zod';

const uuid = z.uuid();
const instant = z.iso.datetime();
const revision = z.number().int().positive();
export const TaskPhaseSchema = z.enum(['planned', 'next', 'active', 'completed']);
export const TaskOpenPhaseSchema = z.enum(['planned', 'next', 'active']);
export const TaskContentSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000),
  notes: z.string().max(20_000),
});
export const TaskOrganizationSchema = z.strictObject({
  boardId: uuid.nullable().default(null),
  columnId: uuid.nullable().default(null),
  projectId: uuid.nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  priority: z.enum(['none', 'low', 'normal', 'high', 'urgent']).default('none'),
});
export const TaskScheduleSchema = z.strictObject({
  dueAt: instant.nullable().default(null),
  scheduledAt: instant.nullable().default(null),
  seriesId: uuid.nullable().default(null),
  occurrenceKey: z.string().max(100).nullable().default(null),
  skippedAt: instant.nullable().default(null),
});
export const TaskSchema = z
  .strictObject({
    id: uuid,
    revision,
    phase: TaskPhaseSchema,
    content: TaskContentSchema,
    organization: TaskOrganizationSchema.default(() => TaskOrganizationSchema.parse({})),
    schedule: TaskScheduleSchema.default(() => TaskScheduleSchema.parse({})),
    paused: z.boolean().default(false),
    finalReviewRequired: z.boolean().default(false),
    finalReviewSatisfied: z.boolean().default(false),
    order: z.number().int().nonnegative(),
    createdAt: instant,
    updatedAt: instant,
    completedAt: instant.nullable(),
    archivedAt: instant.nullable(),
    deletedAt: instant.nullable(),
  })
  .superRefine((task, context) => {
    if ((task.phase === 'completed') !== (task.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Completed tasks require a completion time; open tasks do not have one.',
      });
    }
  });
const commandBase = {
  operationId: uuid,
  taskId: uuid,
  expectedRevision: z.number().int().nonnegative(),
};
export const TaskCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...commandBase,
    type: z.literal('task.create'),
    expectedRevision: z.literal(0),
    content: TaskContentSchema,
  }),
  z.strictObject({ ...commandBase, type: z.literal('task.edit'), content: TaskContentSchema }),
  z.strictObject({
    ...commandBase,
    type: z.literal('task.organize'),
    organization: TaskOrganizationSchema,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('task.schedule'),
    dueAt: instant.nullable(),
    scheduledAt: instant.nullable(),
  }),
  z.strictObject({ ...commandBase, type: z.literal('task.pause'), paused: z.boolean() }),
  z.strictObject({
    ...commandBase,
    type: z.literal('task.review'),
    required: z.boolean(),
    satisfied: z.boolean(),
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('task.move'),
    phase: TaskOpenPhaseSchema,
    beforeTaskId: uuid.nullable(),
  }),
  z.strictObject({ ...commandBase, type: z.literal('task.complete') }),
  z.strictObject({ ...commandBase, type: z.literal('task.reopen'), phase: TaskOpenPhaseSchema }),
  z.strictObject({ ...commandBase, type: z.literal('task.archive') }),
  z.strictObject({ ...commandBase, type: z.literal('task.unarchive') }),
  z.strictObject({ ...commandBase, type: z.literal('task.delete') }),
  z.strictObject({ ...commandBase, type: z.literal('task.restore') }),
]);
export const TaskListSchema = z.strictObject({ tasks: z.array(TaskSchema) });
export const TaskResponseSchema = z.strictObject({ task: TaskSchema });
export const TaskCommandResponseSchema = z.strictObject({
  operationId: uuid,
  task: TaskSchema,
  changedTasks: z.array(TaskSchema),
  feedPosition: z.string().regex(/^\d+$/),
});
export const TaskHistoryEventSchema = z.strictObject({
  id: z.string().regex(/^\d+$/),
  operationId: uuid,
  actorId: z.string().min(1),
  actorType: z.enum(['human', 'agent']),
  type: z.enum([
    'task.create',
    'task.edit',
    'task.organize',
    'task.schedule',
    'task.pause',
    'task.review',
    'task.move',
    'task.complete',
    'task.reopen',
    'task.archive',
    'task.unarchive',
    'task.delete',
    'task.restore',
    'task.file.finalize',
    'task.file.detach',
  ]),
  revision,
  task: TaskSchema,
  createdAt: instant,
});
export const TaskHistorySchema = z.strictObject({
  events: z.array(TaskHistoryEventSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type Task = z.infer<typeof TaskSchema>;
export type TaskContent = z.infer<typeof TaskContentSchema>;
export type TaskCommand = z.infer<typeof TaskCommandSchema>;
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;
export type TaskOpenPhase = z.infer<typeof TaskOpenPhaseSchema>;
export type TaskList = z.infer<typeof TaskListSchema>;
export type TaskResponse = z.infer<typeof TaskResponseSchema>;
export type TaskCommandResponse = z.infer<typeof TaskCommandResponseSchema>;
export type TaskHistory = z.infer<typeof TaskHistorySchema>;
export type TaskHistoryEvent = z.infer<typeof TaskHistoryEventSchema>;

export class TaskRuleError extends Error {
  constructor(
    public readonly code:
      'invalid_transition' | 'revision_conflict' | 'not_found' | 'already_exists',
    message: string,
  ) {
    super(message);
    this.name = 'TaskRuleError';
  }
}

const allowedMoves: Record<TaskOpenPhase, readonly TaskOpenPhase[]> = {
  planned: ['planned', 'next'],
  next: ['planned', 'next', 'active'],
  active: ['planned', 'next', 'active'],
};

export function assertTaskCommandAllowed(task: Task | null, command: TaskCommand): void {
  if (command.type === 'task.create') {
    if (task) throw new TaskRuleError('already_exists', 'This task already exists.');
    return;
  }
  if (!task || task.id !== command.taskId) throw new TaskRuleError('not_found', 'Task not found.');
  if (task.revision !== command.expectedRevision)
    throw new TaskRuleError('revision_conflict', 'This task changed. Refresh before trying again.');
  if (task.deletedAt !== null && command.type !== 'task.restore')
    throw new TaskRuleError('invalid_transition', 'Restore this deleted task before changing it.');
  if (command.type === 'task.restore' && task.deletedAt === null)
    throw new TaskRuleError('invalid_transition', 'This task is not deleted.');
  if (
    task.archivedAt !== null &&
    !['task.unarchive', 'task.delete', 'task.restore'].includes(command.type)
  )
    throw new TaskRuleError('invalid_transition', 'Unarchive this task before changing it.');
  if (
    command.type === 'task.move' &&
    (task.phase === 'completed' || !allowedMoves[task.phase].includes(command.phase))
  )
    throw new TaskRuleError(
      'invalid_transition',
      'Release Planned work to Next before starting it. Reopen completed work explicitly.',
    );
  if (command.type === 'task.move' && command.beforeTaskId === task.id)
    throw new TaskRuleError('invalid_transition', 'A task cannot be ordered before itself.');
  if (command.type === 'task.complete' && task.phase === 'completed')
    throw new TaskRuleError('invalid_transition', 'This task is already completed.');
  if (command.type === 'task.reopen' && task.phase !== 'completed')
    throw new TaskRuleError('invalid_transition', 'Only completed tasks can be reopened.');
  if (command.type === 'task.archive' && task.archivedAt !== null)
    throw new TaskRuleError('invalid_transition', 'This task is already archived.');
  if (command.type === 'task.unarchive' && task.archivedAt === null)
    throw new TaskRuleError('invalid_transition', 'This task is not archived.');
}

export function applyTaskCommand(
  task: Task | null,
  command: TaskCommand,
  now: string,
  order = task?.order ?? 0,
): Task {
  assertTaskCommandAllowed(task, command);
  if (command.type === 'task.create')
    return {
      id: command.taskId,
      revision: 1,
      phase: 'planned',
      content: command.content,
      organization: TaskOrganizationSchema.parse({}),
      schedule: TaskScheduleSchema.parse({}),
      paused: false,
      finalReviewRequired: false,
      finalReviewSatisfied: false,
      order,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      archivedAt: null,
      deletedAt: null,
    };
  if (!task) throw new TaskRuleError('not_found', 'Task not found.');
  const updated = { ...task, revision: task.revision + 1, updatedAt: now };
  switch (command.type) {
    case 'task.organize':
      return { ...updated, organization: command.organization };
    case 'task.schedule':
      return {
        ...updated,
        schedule: { ...task.schedule, dueAt: command.dueAt, scheduledAt: command.scheduledAt },
      };
    case 'task.pause':
      return { ...updated, paused: command.paused };
    case 'task.review':
      return {
        ...updated,
        finalReviewRequired: command.required,
        finalReviewSatisfied: command.satisfied,
      };
    case 'task.edit':
      return { ...updated, content: command.content };
    case 'task.move':
      return { ...updated, phase: command.phase, order };
    case 'task.complete':
      return { ...updated, phase: 'completed', completedAt: now };
    case 'task.reopen':
      return { ...updated, phase: command.phase, completedAt: null };
    case 'task.archive':
      return { ...updated, archivedAt: now };
    case 'task.unarchive':
      return { ...updated, archivedAt: null };
    case 'task.delete':
      return { ...updated, deletedAt: now };
    case 'task.restore':
      return { ...updated, deletedAt: null };
  }
}

export const taskSchema = TaskSchema;
export const taskContentSchema = TaskContentSchema;
export const taskCommandSchema = TaskCommandSchema;
export const taskListSchema = TaskListSchema;
export const taskResponseSchema = TaskResponseSchema;
export const taskCommandResponseSchema = TaskCommandResponseSchema;
export const taskHistorySchema = TaskHistorySchema;

export const TaskListResponseSchema = TaskListSchema;
export const TaskHistoryResponseSchema = TaskHistorySchema;
