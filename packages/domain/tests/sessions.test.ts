import { RoutineTargetSchema } from '../src/workouts.js';
import {
  SessionCommandSchema,
  SessionSchema,
  measuredWorkingVolume,
  timerRemaining,
  type WorkoutSession,
} from '../src/sessions.js';
const id = '10000000-0000-4000-8000-000000000001';
const now = '2026-10-12T12:00:00.000Z';
const session: WorkoutSession = {
  id,
  revision: 1,
  name: 'Fixture',
  notes: '',
  status: 'active',
  sourceRoutineId: null,
  sourceRoutineRevision: null,
  items: [],
  supersets: [],
  timer: null,
  startedAt: now,
  updatedAt: now,
  finishedAt: null,
};
test('strict semantic commands forbid accidental snapshot replacements and invalid measurements', () => {
  expect(
    SessionCommandSchema.safeParse({
      type: 'session.start',
      operationId: id,
      sessionId: id,
      expectedRevision: 0,
      name: 'Fixture',
      routineId: null,
      expectedRoutineRevision: null,
    }).success,
  ).toBe(true);
  expect(
    SessionCommandSchema.safeParse({
      type: 'session.start',
      operationId: id,
      sessionId: id,
      expectedRevision: 0,
      name: 'Fixture',
      routineId: null,
      expectedRoutineRevision: null,
      items: [],
    }).success,
  ).toBe(false);
  expect(
    SessionCommandSchema.safeParse({
      type: 'session.record-set',
      operationId: id,
      sessionId: id,
      expectedRevision: 1,
      itemId: id,
      setId: id,
      kind: 'working',
      measurements: { mode: 'weighted', reps: -1, loadKg: 20 },
      notes: '',
      round: null,
    }).success,
  ).toBe(false);
  expect(SessionSchema.safeParse({ ...session, status: 'completed' }).success).toBe(false);
});
test('timers derive remaining from persisted server deadline and paused state', () => {
  const timer = {
    id,
    kind: 'rest' as const,
    state: 'running' as const,
    durationSeconds: 60,
    remainingSeconds: 60,
    deadline: '2026-10-12T12:01:00.000Z',
    updatedAt: now,
    clockBasis: 'server' as const,
    initiatingDeviceId: 'fictional-phone',
    itemId: null,
  };
  expect(timerRemaining(timer, '2026-10-12T12:00:40.000Z')).toBe(20);
  expect(timerRemaining(timer, '2026-10-12T12:03:40.000Z')).toBe(0);
  expect(
    timerRemaining(
      { ...timer, state: 'paused', deadline: null, remainingSeconds: 19 },
      '2026-10-13T12:00:40.000Z',
    ),
  ).toBe(19);
  expect(measuredWorkingVolume(session)).toBe(0);
});

test('actual results require performance while empty plan targets remain valid', () => {
  const measurements = { mode: 'weighted', reps: null, loadKg: null };
  expect(
    RoutineTargetSchema.safeParse({ id, kind: 'working', measurements, notes: '' }).success,
  ).toBe(true);
  const command = {
    type: 'session.record-set',
    operationId: id,
    sessionId: id,
    expectedRevision: 1,
    itemId: id,
    setId: id,
    kind: 'working',
    measurements,
    notes: '',
    round: null,
  };
  expect(SessionCommandSchema.safeParse(command).success).toBe(false);
  expect(
    SessionCommandSchema.safeParse({ ...command, measurements: { ...measurements, reps: 0 } })
      .success,
  ).toBe(true);
});
