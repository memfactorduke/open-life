import {
  TaskCommandSchema,
  TaskContentSchema,
  TaskSchema,
  applyTaskCommand,
  type Task,
  type TaskCommand,
} from '../src';

const id = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-12T12:00:00.000Z';
const later = '2026-10-12T13:00:00.000Z';
const content = { title: 'Buy supplies', description: '', notes: '' };
const create: TaskCommand = {
  type: 'task.create',
  operationId,
  taskId: id,
  expectedRevision: 0,
  content,
};
const command = (
  type: 'task.complete' | 'task.archive' | 'task.delete' | 'task.restore' | 'task.unarchive',
  task: Task,
): TaskCommand => ({ type, operationId, taskId: id, expectedRevision: task.revision });

test('creates a Planned task with a stable ID and UTC event times', () => {
  const task = applyTaskCommand(null, create, now, 3);
  expect(task).toEqual({
    id,
    revision: 1,
    phase: 'planned',
    content,
    order: 3,
    organization: { boardId: null, columnId: null, projectId: null, tags: [], priority: 'none' },
    schedule: {
      dueAt: null,
      scheduledAt: null,
      seriesId: null,
      occurrenceKey: null,
      skippedAt: null,
    },
    paused: false,
    finalReviewRequired: false,
    finalReviewSatisfied: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
  });
  expect(() =>
    applyTaskCommand(
      task,
      {
        type: 'task.move',
        operationId,
        taskId: id,
        expectedRevision: 1,
        phase: 'active',
        beforeTaskId: null,
      },
      later,
    ),
  ).toThrow('Release Planned');
});

test('trims titles and rejects unknown ownership, invalid revisions, and oversized content', () => {
  expect(TaskContentSchema.parse({ ...content, title: '  Buy supplies  ' })).toEqual(content);
  for (const invalid of [
    { ...content, title: ' ' },
    { ...content, title: 'x'.repeat(501) },
    { ...content, notes: 'x'.repeat(20001) },
  ])
    expect(TaskContentSchema.safeParse(invalid).success).toBe(false);
  for (const invalid of [
    { ...create, ownerId: 'owner' },
    { ...create, expectedRevision: 1 },
    { ...create, taskId: 'not-uuid' },
  ])
    expect(TaskCommandSchema.safeParse(invalid).success).toBe(false);
});

test('requires deliberate release before Active and rejects stale writes', () => {
  const task = applyTaskCommand(null, create, now);
  expect(() =>
    applyTaskCommand(
      task,
      {
        type: 'task.move',
        operationId,
        taskId: id,
        expectedRevision: 1,
        phase: 'active',
        beforeTaskId: null,
      },
      later,
    ),
  ).toThrow('Release Planned');
  const next = applyTaskCommand(
    task,
    {
      type: 'task.move',
      operationId,
      taskId: id,
      expectedRevision: 1,
      phase: 'next',
      beforeTaskId: null,
    },
    later,
    5,
  );
  expect({ phase: next.phase, revision: next.revision, order: next.order }).toEqual({
    phase: 'next',
    revision: 2,
    order: 5,
  });
  expect(() =>
    applyTaskCommand(
      next,
      { type: 'task.edit', operationId, taskId: id, expectedRevision: 1, content },
      later,
    ),
  ).toThrow('changed');
  const active = applyTaskCommand(
    next,
    {
      type: 'task.move',
      operationId,
      taskId: id,
      expectedRevision: 2,
      phase: 'active',
      beforeTaskId: null,
    },
    later,
  );
  expect({ phase: active.phase, revision: active.revision }).toEqual({
    phase: 'active',
    revision: 3,
  });
});

test('completion and reopening preserve identity while clearing the current completion time', () => {
  const completed = applyTaskCommand(
    applyTaskCommand(null, create, now),
    { type: 'task.complete', operationId, taskId: id, expectedRevision: 1 },
    later,
  );
  expect({
    id: completed.id,
    phase: completed.phase,
    completedAt: completed.completedAt,
    revision: completed.revision,
  }).toEqual({ id, phase: 'completed', completedAt: later, revision: 2 });
  expect(() =>
    applyTaskCommand(
      completed,
      {
        type: 'task.move',
        operationId,
        taskId: id,
        expectedRevision: 2,
        phase: 'next',
        beforeTaskId: null,
      },
      later,
    ),
  ).toThrow('Reopen');
  const reopened = applyTaskCommand(
    completed,
    { type: 'task.reopen', operationId, taskId: id, expectedRevision: 2, phase: 'planned' },
    later,
  );
  expect({
    phase: reopened.phase,
    completedAt: reopened.completedAt,
    revision: reopened.revision,
  }).toEqual({ phase: 'planned', completedAt: null, revision: 3 });
  expect(TaskSchema.safeParse({ ...completed, completedAt: null }).success).toBe(false);
});

test('archive and deletion need explicit corrections and keep previous lifecycle information', () => {
  const task = applyTaskCommand(null, create, now);
  const archived = applyTaskCommand(task, command('task.archive', task), later);
  expect({ phase: archived.phase, archivedAt: archived.archivedAt }).toEqual({
    phase: 'planned',
    archivedAt: later,
  });
  expect(() => applyTaskCommand(archived, command('task.complete', archived), later)).toThrow(
    'Unarchive',
  );
  const deleted = applyTaskCommand(archived, command('task.delete', archived), later);
  expect(() => applyTaskCommand(deleted, command('task.unarchive', deleted), later)).toThrow(
    'Restore',
  );
  const restored = applyTaskCommand(deleted, command('task.restore', deleted), later);
  expect({
    deletedAt: restored.deletedAt,
    archivedAt: restored.archivedAt,
    revision: restored.revision,
  }).toEqual({ deletedAt: null, archivedAt: later, revision: 4 });
});
