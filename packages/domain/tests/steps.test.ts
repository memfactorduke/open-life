import { TaskSchema, TaskStepSchema, stepRollup, validateStepGraph } from '../src';
const taskId = '11111111-1111-4111-8111-111111111111';
const stepId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const now = '2026-10-13T00:30:00.000Z';
const task = TaskSchema.parse({
  id: taskId,
  revision: 1,
  phase: 'next',
  content: { title: 'Fixture', description: '', notes: '' },
  order: 0,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  archivedAt: null,
  deletedAt: null,
});
const step = TaskStepSchema.parse({
  id: stepId,
  taskId,
  revision: 1,
  content: {
    title: 'Fixture step',
    instructions: '',
    responsibility: 'human',
    required: true,
    dependencies: [],
    order: 0,
  },
  status: 'pending',
  assignedTo: null,
  createdAt: now,
  updatedAt: now,
});
test('graphs reject ambiguous identity, foreign parents, missing/deleted prerequisites and cycles', () => {
  expect(() => validateStepGraph([step, step])).toThrow('unique');
  expect(() => validateStepGraph([step, { ...step, id: otherId, taskId: otherId }])).toThrow(
    'parent task',
  );
  expect(() =>
    validateStepGraph([{ ...step, content: { ...step.content, dependencies: [otherId] } }]),
  ).toThrow('live step');
  expect(() =>
    validateStepGraph([
      { ...step, content: { ...step.content, dependencies: [otherId] } },
      { ...step, id: otherId, deletedAt: now },
    ]),
  ).toThrow('live step');
  expect(() =>
    validateStepGraph([{ ...step, content: { ...step.content, dependencies: [stepId] } }]),
  ).toThrow('cycle');
  expect(() =>
    validateStepGraph([
      step,
      { ...step, id: otherId, content: { ...step.content, dependencies: [stepId] } },
    ]),
  ).not.toThrow();
});
test('rollups exclude foreign and deleted work from readiness and completion', () => {
  const prerequisite = { ...step, id: otherId, status: 'completed' as const, deletedAt: now };
  const dependent = { ...step, content: { ...step.content, dependencies: [otherId] } };
  const rollup = stepRollup(task, [
    dependent,
    prerequisite,
    { ...step, id: taskId, taskId: otherId },
  ]);
  expect(rollup.entries).toHaveLength(1);
  expect(rollup.entries[0]?.waitingReason).toBe('dependencies');
  expect(rollup.nextActions).toEqual([]);
  expect(rollup.canComplete).toBe(false);
  expect(stepRollup(task, [prerequisite]).canComplete).toBe(true);
});
