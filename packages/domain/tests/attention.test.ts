import { buildTaskAttention, notificationRoute, attentionDate } from '../src/attention.js';
import { TaskSchema } from '../src/tasks.js';
import { TaskStepSchema } from '../src/steps.js';
const taskId = '11111111-1111-4111-8111-111111111111',
  stepId = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-13T00:30:00.000Z';
const task = TaskSchema.parse({
  id: taskId,
  revision: 1,
  phase: 'next',
  content: { title: 'Fictional task', description: '', notes: '' },
  order: 0,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  archivedAt: null,
  deletedAt: null,
  schedule: { dueAt: '2026-10-12T12:00:00.000Z' },
});
const step = TaskStepSchema.parse({
  id: stepId,
  taskId,
  revision: 1,
  content: {
    title: 'Human review',
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
test('due human attention preserves IDs and deduplicates unrelated edits', () => {
  const items = buildTaskAttention([task], [step], [], [], now);
  expect(items[0]?.kind).toBe('due');
  expect(items[0]?.route).toEqual({ kind: 'task', id: taskId });
  expect(
    buildTaskAttention([{ ...task, revision: 2 }], [{ ...step, revision: 2 }], [], [], now)[0]
      ?.dedupeKey,
  ).toBe(items[0]?.dedupeKey);
});
test('planned, paused, dependency waiting and agent-only work are not human next actions', () => {
  expect(
    buildTaskAttention([{ ...task, phase: 'planned' }], [step], [], [], now)[0]?.waitingReason,
  ).toBe('not_released');
  expect(
    buildTaskAttention([{ ...task, paused: true }], [step], [], [], now)[0]?.waitingReason,
  ).toBe('paused');
  expect(
    buildTaskAttention(
      [task],
      [{ ...step, content: { ...step.content, responsibility: 'agent' } }],
      [],
      [],
      now,
    )[0]?.waitingReason,
  ).toBe('agent');
  expect(
    buildTaskAttention(
      [task],
      [
        {
          ...step,
          content: { ...step.content, dependencies: ['33333333-3333-4333-8333-333333333333'] },
        },
      ],
      [],
      [],
      now,
    )[0]?.waitingReason,
  ).toBe('dependencies');
});
test('notification route accepts only explicit opaque record IDs and time zone day is local', () => {
  expect(notificationRoute({ kind: 'task', id: taskId })).toEqual({ kind: 'task', id: taskId });
  expect(notificationRoute({ kind: 'task', id: 'https://example.test' })).toBeNull();
  expect(notificationRoute({ kind: 'task', id: taskId, url: 'https://example.test' })).toBeNull();
  expect(attentionDate(now, 'America/New_York')).toBe('2026-10-12');
});

import { AgentAttemptSchema, AgentResultSchema } from '../src/agent-workflows.js';
const attemptId = '44444444-4444-4444-8444-444444444444';
const requirements = [{ key: 'proof', kind: 'text' as const, required: true }];
const attempt = AgentAttemptSchema.parse({
  id: attemptId,
  taskId,
  stepId,
  revision: 1,
  actorId: 'fictional-worker',
  status: 'submitted',
  expiresAt: '2026-10-13T01:30:00.000Z',
  createdAt: now,
  updatedAt: now,
  snapshot: {
    stepContent: { ...step.content, responsibility: 'agent' },
    stepRevision: 1,
    binding: {
      taskId,
      stepId,
      revision: 1,
      skillId: '55555555-5555-4555-8555-555555555555',
      skillVersion: 1,
      inputs: {},
      requirements,
      risk: 'none',
      retryable: true,
      requiresApproval: false,
    },
    skill: {
      name: 'Fictional skill',
      instructions: 'Produce fictional evidence',
      resources: [],
      inputKeys: [],
      requirements,
    },
  },
  progress: [],
  error: null,
  reconciliation: null,
});
const result = AgentResultSchema.parse({
  id: '66666666-6666-4666-8666-666666666666',
  revision: 1,
  taskId,
  stepId,
  attemptId,
  version: 1,
  artifacts: [{ key: 'proof', kind: 'text', text: 'Fictional evidence' }],
  summary: 'Complete',
  approvedAt: null,
  approvedBy: null,
  feedback: null,
  createdAt: now,
});
test('ordinary successful agent results do not become approval alerts; explicit approval does', () => {
  const agentStep = {
    ...step,
    content: { ...step.content, responsibility: 'agent' as const },
    status: 'completed' as const,
  };
  expect(
    buildTaskAttention([task], [agentStep], [attempt], [result], now).filter(
      (i) => i.kind === 'review',
    ),
  ).toHaveLength(0);
  const reviewAttempt = {
    ...attempt,
    snapshot: {
      ...attempt.snapshot,
      binding: { ...attempt.snapshot.binding, requiresApproval: true },
    },
  };
  expect(
    buildTaskAttention(
      [task],
      [{ ...agentStep, status: 'active' }],
      [reviewAttempt],
      [result],
      now,
    ).filter((i) => i.kind === 'review'),
  ).toHaveLength(1);
});
test('failed and unknown attempts remain visible while the task is paused; either work owned by agent waits', () => {
  const eitherStep = {
    ...step,
    content: { ...step.content, responsibility: 'either' as const },
    status: 'active' as const,
  };
  const running = { ...attempt, status: 'running' as const };
  expect(buildTaskAttention([task], [eitherStep], [running], [], now)[0]?.waitingReason).toBe(
    'agent',
  );
  const failed = { ...attempt, status: 'failed' as const };
  expect(
    buildTaskAttention([{ ...task, paused: true }], [step], [failed], [], now).some(
      (i) => i.kind === 'failure',
    ),
  ).toBe(true);
  const unknown = { ...attempt, status: 'outcome-unknown' as const };
  expect(
    buildTaskAttention([{ ...task, paused: true }], [step], [unknown], [], now).some(
      (i) => i.kind === 'outcome-unknown',
    ),
  ).toBe(true);
});
