import { RoutineTargetSchema } from '../src/workouts.js';
import {
  SessionCommandSchema,
  SessionSchema,
  SessionTimerSchema,
  measuredWorkingVolume,
  timerRemaining,
  sessionEventTime,
  type WorkoutSession,
  type SessionCommand,
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

test('historical event timestamps are optional, validated and confined to history commands', () => {
  const start = {
    type: 'session.start',
    operationId: id,
    sessionId: id,
    expectedRevision: 0,
    name: 'Fixture',
    routineId: null,
    expectedRoutineRevision: null,
  };
  expect(
    SessionCommandSchema.safeParse({ ...start, occurredAt: '2026-10-09T20:00:00.000Z' }).success,
  ).toBe(true);
  expect(SessionCommandSchema.safeParse({ ...start, occurredAt: 'Friday evening' }).success).toBe(
    false,
  );
  expect(
    SessionCommandSchema.safeParse({
      type: 'session.timer',
      operationId: id,
      sessionId: id,
      expectedRevision: 1,
      action: 'start',
      timerId: id,
      kind: 'rest',
      durationSeconds: 60,
      deviceId: 'fixture',
      itemId: null,
      occurredAt: now,
    }).success,
  ).toBe(false);
  expect(sessionEventTime(SessionCommandSchema.parse(start), null, now)).toBe(now);
});
test('event clock allows delayed replay and small clock skew but rejects impossible history', () => {
  const finish = {
    type: 'session.finish' as const,
    operationId: id,
    sessionId: id,
    expectedRevision: 1,
    occurredAt: '2026-10-12T13:00:00.000Z',
  };
  expect(sessionEventTime(finish, session, '2026-10-16T12:00:00.000Z')).toBe(
    '2026-10-12T13:00:00.000Z',
  );
  expect(() => sessionEventTime(finish, session, now)).toThrow('future');
  expect(() =>
    sessionEventTime({ ...finish, occurredAt: '2026-10-12T11:00:00.000Z' }, session, now),
  ).toThrow('start');
  expect(
    sessionEventTime({ ...finish, occurredAt: '2026-10-12T12:04:00.000Z' }, session, now),
  ).toBe('2026-10-12T12:04:00.000Z');
});

test('server-time fallback validates chronological history just like explicit event time', () => {
  const finish: SessionCommand = {
    type: 'session.finish',
    operationId: id,
    sessionId: id,
    expectedRevision: 1,
  };
  const futureStart = { ...session, startedAt: '2026-10-12T12:04:00.000Z' };
  expect(() => sessionEventTime(finish, futureStart, now)).toThrow('start');
  const recorded = {
    ...session,
    items: [
      {
        id,
        exerciseId: id,
        snapshot: { name: 'Fixture', mode: 'weighted' as const, supportsLoad: true },
        targets: [],
        notes: '',
        status: 'in-progress' as const,
        replacedItemId: null,
        results: [
          {
            id,
            kind: 'working' as const,
            measurements: { mode: 'weighted' as const, reps: 5, loadKg: 20 },
            notes: '',
            round: null,
            recordedAt: '2026-10-12T12:04:00.000Z',
            correctedAt: null,
            removedAt: null,
          },
        ],
      },
    ],
  };
  expect(() => sessionEventTime(finish, recorded, now)).toThrow('recorded set');
  expect(() =>
    sessionEventTime(
      {
        type: 'session.correct-set',
        operationId: id,
        sessionId: id,
        expectedRevision: 1,
        itemId: id,
        setId: id,
        kind: 'working',
        measurements: { mode: 'weighted', reps: 6, loadKg: 20 },
        notes: '',
        round: null,
        reason: 'Fixture correction',
      },
      recorded,
      now,
    ),
  ).toThrow('correction');
});

test('timer rollback never extends the saved remaining interval', () => {
  const timer = {
    id,
    kind: 'rest' as const,
    state: 'running' as const,
    durationSeconds: 60,
    remainingSeconds: 20,
    deadline: '2026-10-12T12:00:20.000Z',
    updatedAt: now,
    clockBasis: 'server' as const,
    initiatingDeviceId: 'fictional-phone',
    itemId: null,
  };
  expect(timerRemaining(timer, '2026-10-12T11:00:00.000Z')).toBe(20);
  expect(SessionTimerSchema.safeParse({ ...timer, deadline: null }).success).toBe(false);
  expect(SessionTimerSchema.safeParse({ ...timer, state: 'paused' }).success).toBe(false);
  expect(SessionTimerSchema.safeParse({ ...timer, remainingSeconds: 61 }).success).toBe(false);
  expect(SessionTimerSchema.safeParse({ ...timer, state: 'paused', deadline: null }).success).toBe(
    true,
  );
});

test('session snapshots reject invalid planned measurements and colliding target/result identities', () => {
  const targetId = '10000000-0000-4000-8000-000000000002';
  const itemId = '10000000-0000-4000-8000-000000000003';
  const item = {
    id: itemId,
    exerciseId: id,
    snapshot: { name: 'Fixture', mode: 'weighted', supportsLoad: true },
    targets: [
      {
        id: targetId,
        kind: 'working',
        measurements: { mode: 'weighted', reps: 5, loadKg: 20 },
        notes: '',
      },
    ],
    notes: '',
    status: 'planned',
    results: [],
    replacedItemId: null,
  };
  expect(SessionSchema.safeParse({ ...session, items: [item] }).success).toBe(true);
  expect(
    SessionSchema.safeParse({
      ...session,
      items: [{ ...item, targets: [item.targets[0], item.targets[0]] }],
    }).success,
  ).toBe(false);
  expect(
    SessionSchema.safeParse({
      ...session,
      items: [{ ...item, snapshot: { ...item.snapshot, mode: 'timed' } }],
    }).success,
  ).toBe(false);
  expect(
    SessionSchema.safeParse({
      ...session,
      items: [{ ...item, snapshot: { ...item.snapshot, supportsLoad: false } }],
    }).success,
  ).toBe(false);
  expect(
    SessionSchema.safeParse({
      ...session,
      items: [
        {
          ...item,
          results: [
            {
              id: targetId,
              kind: 'working',
              measurements: { mode: 'weighted', reps: 5, loadKg: 20 },
              notes: '',
              round: null,
              recordedAt: now,
              correctedAt: null,
              removedAt: null,
            },
          ],
        },
      ],
    }).success,
  ).toBe(false);
});
