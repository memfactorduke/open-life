import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { measuredWorkingVolume, timerRemaining, type SessionCommand } from '@mems-life/domain';
import { migrate, bootstrapOwner } from '../src/database.js';
import { migrateSessions } from '../src/session-migrations.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { executeRoutineCommand, listExercises, readRoutine } from '../src/workouts.js';
import {
  executeSessionCommand,
  readSession,
  listSessions,
  sessionHistory,
  exercisePerformance,
} from '../src/sessions.js';
const url =
  process.env.SESSIONS_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_sessions_test';
if (new URL(url).pathname !== '/mems_life_sessions_test')
  throw Error('Only isolated mems_life_sessions_test allowed.');
const config = readConfig({
  DATABASE_URL: url,
  BETTER_AUTH_SECRET: 'fictional-session-test-secret-minimum-length',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
test('PostgreSQL session snapshots, revisions, replay, corrections, history, modes, supersets and timers', async () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateSessions(pool);
    await migrateSessions(pool);
    await bootstrapOwner(pool, config, {
      email: 'sessions@example.test',
      name: 'Session Fixture',
      password: 'fictional-sessions-password123',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const auth = async () => {};
    const exercises = (await listExercises(pool, actor)).exercises;
    const weighted = exercises.find((e) => e.mode === 'weighted')!;
    const timed = exercises.find((e) => e.mode === 'timed')!;
    const routineId = randomUUID();
    const itemId = randomUUID();
    const content = {
      name: 'Fixture plan',
      notes: 'plan note',
      items: [
        {
          id: itemId,
          exerciseId: weighted.id,
          snapshot: {
            name: weighted.name,
            mode: weighted.mode,
            supportsLoad: weighted.supportsLoad,
          },
          targets: [
            {
              id: randomUUID(),
              kind: 'working' as const,
              measurements: { mode: 'weighted' as const, reps: 10, loadKg: 50 },
              notes: '',
            },
          ],
          notes: '',
        },
      ],
    };
    await executeRoutineCommand(
      pool,
      actor,
      {
        type: 'routine.create',
        operationId: randomUUID(),
        routineId,
        expectedRevision: 0,
        content,
      },
      auth,
    );
    const start = {
      type: 'session.start' as const,
      operationId: randomUUID(),
      sessionId: randomUUID(),
      expectedRevision: 0 as const,
      name: 'Actual workout',
      routineId,
      expectedRoutineRevision: 1,
    };
    let response = await executeSessionCommand(pool, actor, start, auth);
    assert.deepEqual(await executeSessionCommand(pool, actor, start, auth), response);
    assert.equal(response.session.items[0]!.results.length, 0);
    assert.notEqual(response.session.items[0]!.id, itemId);
    assert.equal(measuredWorkingVolume(response.session), 0);
    await assert.rejects(
      executeSessionCommand(pool, actor, start, async (client) => {
        assert.equal((await client.query('SELECT 1')).rowCount, 1);
        throw Error('revoked');
      }),
      /revoked/,
    );
    await assert.rejects(
      executeSessionCommand(pool, actor, { ...start, name: 'changed' }, auth),
      /operation ID/,
    );
    await assert.rejects(
      executeSessionCommand(
        pool,
        actor,
        { ...start, operationId: randomUUID(), sessionId: randomUUID() },
        auth,
      ),
      /active workout/,
    );
    async function run(command: object) {
      response = await executeSessionCommand(
        pool,
        actor,
        {
          ...command,
          sessionId: response.session.id,
          expectedRevision: response.session.revision,
          operationId: randomUUID(),
        } as SessionCommand,
        auth,
      );
      return response;
    }
    const actualId = response.session.items[0]!.id;
    const setId = randomUUID();
    await run({
      type: 'session.record-set',
      itemId: actualId,
      setId,
      kind: 'warmup',
      measurements: { mode: 'weighted', reps: 5, loadKg: 20 },
      notes: 'actual',
      round: null,
    });
    assert.equal(measuredWorkingVolume(response.session), 0);
    await run({
      type: 'session.record-set',
      itemId: actualId,
      setId: randomUUID(),
      kind: 'working',
      measurements: { mode: 'weighted', reps: 5, loadKg: 60 },
      notes: '',
      round: null,
    });
    assert.equal(measuredWorkingVolume(response.session), 300);
    const revision = response.session.revision;
    const concurrent = await Promise.allSettled(
      [1, 2].map((n) =>
        executeSessionCommand(
          pool,
          actor,
          {
            type: 'session.set-notes',
            sessionId: response.session.id,
            expectedRevision: revision,
            operationId: randomUUID(),
            itemId: null,
            notes: `Concurrent ${n}`,
          },
          auth,
        ),
      ),
    );
    assert.equal(concurrent.filter((x) => x.status === 'fulfilled').length, 1);
    response = { ...response, ...(await readSession(pool, actor, response.session.id)) };
    const before = response.session.revision;
    await assert.rejects(
      run({
        type: 'session.record-set',
        itemId: actualId,
        setId: randomUUID(),
        kind: 'working',
        measurements: { mode: 'timed', durationSeconds: 10, loadKg: null },
        notes: '',
        round: null,
      }),
      /Result mode/,
    );
    assert.equal((await readSession(pool, actor, response.session.id)).session.revision, before);
    const secondId = randomUUID();
    await run({
      type: 'session.add-exercise',
      itemId: secondId,
      exerciseId: timed.id,
      expectedExerciseRevision: timed.revision,
    });
    await run({
      type: 'session.set-supersets',
      supersets: [{ id: randomUUID(), itemIds: [actualId, secondId] }],
    });
    await run({
      type: 'session.record-set',
      itemId: secondId,
      setId: randomUUID(),
      kind: 'working',
      measurements: { mode: 'timed', durationSeconds: 30, loadKg: null },
      notes: 'timed',
      round: 1,
    });
    assert.equal(measuredWorkingVolume(response.session), 300);
    const timerId = randomUUID();
    await run({
      type: 'session.timer',
      action: 'start',
      timerId,
      kind: 'rest',
      durationSeconds: 60,
      deviceId: 'fixture-phone',
      itemId: null,
    });
    assert.equal(response.session.timer!.initiatingDeviceId, 'fixture-phone');
    assert.equal(
      timerRemaining(
        response.session.timer!,
        new Date(Date.parse(response.session.timer!.deadline!) - 20000).toISOString(),
      ),
      20,
    );
    await run({
      type: 'session.timer',
      action: 'pause',
      timerId,
      kind: 'rest',
      durationSeconds: 60,
      deviceId: 'other-phone',
      itemId: null,
    });
    assert.equal(response.session.timer!.deadline, null);
    await run({
      type: 'session.timer',
      action: 'resume',
      timerId,
      kind: 'rest',
      durationSeconds: 60,
      deviceId: 'other-phone',
      itemId: null,
    });
    assert.equal(response.session.timer!.initiatingDeviceId, 'fixture-phone');
    await executeRoutineCommand(
      pool,
      actor,
      {
        type: 'routine.edit',
        operationId: randomUUID(),
        routineId,
        expectedRevision: 1,
        content: { ...content, name: 'Future plan', items: [] },
      },
      auth,
    );
    assert.equal(response.session.items[0]!.targets.length, 1);
    await run({ type: 'session.finish' });
    assert.equal(response.session.status, 'completed');
    assert.equal(response.session.timer, null);
    assert.equal(response.session.items[1]!.results.length, 1);
    await run({
      type: 'session.correct-set',
      itemId: actualId,
      setId,
      kind: 'working',
      measurements: { mode: 'weighted', reps: 6, loadKg: 20 },
      notes: 'corrected',
      round: 1,
      reason: 'Wrong category',
    });
    assert.equal(measuredWorkingVolume(response.session), 420);
    await run({ type: 'session.remove-set', itemId: actualId, setId, reason: 'Duplicate' });
    assert.equal(measuredWorkingVolume(response.session), 300);
    assert.equal(
      (await exercisePerformance(pool, actor, weighted.id)).performances[0]!
        .measuredWorkingVolumeKgReps,
      300,
    );
    assert.equal(
      (await exercisePerformance(pool, actor, weighted.id, undefined, 50, 'timed')).performances
        .length,
      0,
    );
    assert.equal(
      (
        await exercisePerformance(
          pool,
          actor,
          weighted.id,
          undefined,
          50,
          'weighted',
          response.session.id,
        )
      ).performances.length,
      0,
    );
    const history = await sessionHistory(pool, actor, response.session.id, undefined, 2);
    assert.equal(history.events.length, 2);
    assert.equal(history.events[0]!.reason, 'Duplicate');
    assert.equal(history.events[0]!.actorType, 'owner');
    assert.ok(history.nextCursor);
    assert.equal(
      (await sessionHistory(pool, actor, response.session.id, history.nextCursor!, 2)).events
        .length,
      2,
    );
    assert.equal((await readRoutine(pool, actor, routineId)).routine.name, 'Future plan');
    const empty = {
      ...start,
      operationId: randomUUID(),
      sessionId: randomUUID(),
      routineId: null,
      expectedRoutineRevision: null,
    };
    const fresh = await executeSessionCommand(pool, actor, empty, auth);
    assert.equal(fresh.session.items.length, 0);
    response = fresh;
    const bodyweight = exercises.find((e) => e.mode === 'bodyweight')!;
    const distance = exercises.find((e) => e.mode === 'distance')!;
    const partialItem = randomUUID();
    await run({
      type: 'session.add-exercise',
      itemId: partialItem,
      exerciseId: bodyweight.id,
      expectedExerciseRevision: bodyweight.revision,
    });
    await run({
      type: 'session.record-set',
      itemId: partialItem,
      setId: randomUUID(),
      kind: 'working',
      measurements: { mode: 'bodyweight', reps: 8, addedLoadKg: null },
      notes: 'partial actual',
      round: null,
    });
    await assert.rejects(
      run({
        type: 'session.record-set',
        itemId: partialItem,
        setId: randomUUID(),
        kind: 'working',
        measurements: { mode: 'bodyweight', reps: null, addedLoadKg: null },
        notes: '',
        round: null,
      }),
      /Record repetitions/,
    );
    const substituted = randomUUID();
    await run({
      type: 'session.substitute-exercise',
      itemId: substituted,
      replacedItemId: partialItem,
      exerciseId: distance.id,
      expectedExerciseRevision: distance.revision,
    });
    assert.equal(response.session.items[0]!.results.length, 1);
    assert.equal(response.session.items[0]!.status, 'removed');
    await run({
      type: 'session.record-set',
      itemId: substituted,
      setId: randomUUID(),
      kind: 'working',
      measurements: { mode: 'distance', distanceMeters: 1000, durationSeconds: null, loadKg: null },
      notes: 'actual distance',
      round: null,
    });
    await run({ type: 'session.reorder-exercises', itemIds: [substituted, partialItem] });
    const oldRevision = response.session.revision;
    await assert.rejects(
      run({ type: 'session.update-routine', routineId, expectedRoutineRevision: 1, content }),
      /Reload before saving/,
    );
    assert.equal(
      (await readSession(pool, actor, response.session.id)).session.revision,
      oldRevision,
    );
    assert.equal((await readRoutine(pool, actor, routineId)).routine.revision, 2);
    await run({ type: 'session.update-routine', routineId, expectedRoutineRevision: 2, content });
    assert.equal((await readRoutine(pool, actor, routineId)).routine.revision, 3);
    assert.equal(response.session.items.length, 2);
    await run({ type: 'session.abandon' });
    assert.equal(response.session.status, 'abandoned');
    assert.equal(response.session.items[0]!.results.length, 1);
    assert.equal(measuredWorkingVolume(response.session), 0);
    assert.equal((await listSessions(pool, actor, 'abandoned')).sessions.length, 1);
    assert.equal(
      (await listSessions(pool, actor, undefined, undefined, 1)).nextCursor !== null,
      true,
    );
    await assert.rejects(
      readSession(pool, { ...actor, userId: 'unrelated-fixture' }, response.session.id),
      /own the installation/,
    );
    const stableItemId = randomUUID(),
      stableTargetId = randomUUID();
    const stableStart = {
      ...start,
      operationId: randomUUID(),
      sessionId: randomUUID(),
      expectedRoutineRevision: 3,
      itemIdentities: [
        {
          routineItemId: itemId,
          itemId: stableItemId,
          targets: [
            { routineTargetId: content.items[0]!.targets[0]!.id, targetId: stableTargetId },
          ],
        },
      ],
    };
    for (const itemIdentities of [
      [
        {
          ...stableStart.itemIdentities[0]!,
          targets: [{ routineTargetId: content.items[0]!.targets[0]!.id, targetId: stableItemId }],
        },
      ],
      [{ ...stableStart.itemIdentities[0]!, routineItemId: randomUUID() }],
      [
        {
          ...stableStart.itemIdentities[0]!,
          targets: [{ routineTargetId: randomUUID(), targetId: stableTargetId }],
        },
      ],
      [],
    ]) {
      await assert.rejects(
        executeSessionCommand(
          pool,
          actor,
          { ...stableStart, operationId: randomUUID(), itemIdentities },
          auth,
        ),
        /identities must/,
      );
    }
    const stable = await executeSessionCommand(pool, actor, stableStart, auth);
    assert.deepEqual(await executeSessionCommand(pool, actor, stableStart, auth), stable);
    assert.equal(stable.session.items[0]!.id, stableItemId);
    assert.equal(stable.session.items[0]!.targets[0]!.id, stableTargetId);
    assert.deepEqual(stable.session.items[0]!.snapshot, content.items[0]!.snapshot);
    const measured = await executeSessionCommand(
      pool,
      actor,
      {
        type: 'session.record-set',
        operationId: randomUUID(),
        sessionId: stable.session.id,
        expectedRevision: 1,
        itemId: stableItemId,
        setId: randomUUID(),
        kind: 'working',
        measurements: { mode: 'weighted', reps: 8, loadKg: 45 },
        notes: '',
        round: null,
      },
      auth,
    );
    assert.equal(measured.session.items[0]!.results[0]!.measurements.mode, 'weighted');
    await executeSessionCommand(
      pool,
      actor,
      {
        type: 'session.finish',
        operationId: randomUUID(),
        sessionId: stable.session.id,
        expectedRevision: 2,
      },
      auth,
    );
    const delayedStart = {
      ...stableStart,
      operationId: randomUUID(),
      sessionId: randomUUID(),
      occurredAt: '2026-10-09T20:00:00.000Z',
    };
    const delayed = await executeSessionCommand(pool, actor, delayedStart, auth);
    assert.equal(delayed.session.startedAt, delayedStart.occurredAt);
    assert.notEqual(delayed.session.updatedAt, delayedStart.occurredAt);
    const recordedAt = '2026-10-09T20:10:00.000Z';
    const delayedSet = {
      type: 'session.record-set' as const,
      operationId: randomUUID(),
      sessionId: delayed.session.id,
      expectedRevision: 1,
      itemId: stableItemId,
      setId: randomUUID(),
      kind: 'working' as const,
      measurements: { mode: 'weighted' as const, reps: 8, loadKg: 45 },
      notes: '',
      round: null,
      occurredAt: recordedAt,
    };
    const result = await executeSessionCommand(pool, actor, delayedSet, auth);
    assert.equal(result.session.items[0]!.results[0]!.recordedAt, recordedAt);
    assert.deepEqual(await executeSessionCommand(pool, actor, delayedSet, auth), result);
    await assert.rejects(
      executeSessionCommand(
        pool,
        actor,
        { ...delayedSet, occurredAt: '2026-10-09T20:11:00.000Z' },
        auth,
      ),
      /operation ID/,
    );
    const finish = {
      type: 'session.finish' as const,
      operationId: randomUUID(),
      sessionId: delayed.session.id,
      expectedRevision: 2,
      occurredAt: '2026-10-09T21:00:00.000Z',
    };
    await assert.rejects(
      executeSessionCommand(
        pool,
        actor,
        { ...finish, occurredAt: '2026-10-09T20:05:00.000Z' },
        auth,
      ),
      /recorded set/,
    );
    await assert.rejects(
      executeSessionCommand(
        pool,
        actor,
        { ...finish, occurredAt: new Date(Date.now() + 3600_000).toISOString() },
        auth,
      ),
      /future/,
    );
    const finished = await executeSessionCommand(pool, actor, finish, auth);
    assert.equal(
      Date.parse(finished.session.finishedAt!) - Date.parse(finished.session.startedAt),
      3600_000,
    );
    assert.deepEqual(await executeSessionCommand(pool, actor, finish, auth), finished);
    const correct = {
      ...delayedSet,
      type: 'session.correct-set' as const,
      operationId: randomUUID(),
      expectedRevision: 3,
      reason: 'Fictional correction',
      occurredAt: '2026-10-10T12:00:00.000Z',
      measurements: { ...delayedSet.measurements, reps: 9 },
    };
    const corrected = await executeSessionCommand(pool, actor, correct, auth);
    assert.equal(corrected.session.items[0]!.results[0]!.recordedAt, recordedAt);
    assert.equal(corrected.session.items[0]!.results[0]!.correctedAt, correct.occurredAt);
    const removed = await executeSessionCommand(
      pool,
      actor,
      {
        type: 'session.remove-set',
        operationId: randomUUID(),
        sessionId: delayed.session.id,
        expectedRevision: 4,
        itemId: stableItemId,
        setId: delayedSet.setId,
        reason: 'Fictional removal',
        occurredAt: '2026-10-11T12:00:00.000Z',
      },
      auth,
    );
    assert.equal(removed.session.items[0]!.results[0]!.removedAt, '2026-10-11T12:00:00.000Z');
    const events = (await sessionHistory(pool, actor, delayed.session.id)).events;
    assert(events.every((event) => Date.parse(event.createdAt) > Date.parse(finish.occurredAt)));
  } finally {
    await pool.end();
  }
});
