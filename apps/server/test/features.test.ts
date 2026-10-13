import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { TaskHistorySchema, RoutineCommandSchema } from '@mems-life/domain';
import { migrate, bootstrapOwner, transaction } from '../src/database.js';
import { migrateFeatures, seedOwnerProducts } from '../src/feature-migrations.js';
import { executeTaskCommand, listTasks, readTask, taskHistory } from '../src/tasks.js';
import {
  executeExerciseCommand,
  executeRoutineCommand,
  listExercises,
  readRoutine,
} from '../src/workouts.js';
import { requireOwner } from '../src/operations.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

const databaseUrl =
  process.env.FEATURES_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_features_test';
if (new URL(databaseUrl).pathname !== '/mems_life_features_test')
  throw new Error('Feature tests require the isolated mems_life_features_test database.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-feature-test-secret-minimum-length',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
test('real PostgreSQL task lifecycle, ordering, receipts, permission and rollback; routine catalog, snapshots and units', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateFeatures(pool);
    await migrateFeatures(pool);
    await bootstrapOwner(pool, config, {
      email: 'feature-owner@example.test',
      name: 'Feature Fixture',
      password: 'fictional-feature-password-123',
    });
    const ownerId = (await pool.query('SELECT owner_id FROM installation')).rows[0]
      .owner_id as string;
    await transaction(pool, (client) => seedOwnerProducts(client, ownerId));
    await transaction(pool, (client) => seedOwnerProducts(client, ownerId));
    const actor = await requireOwner(pool, ownerId);
    const authorize = async () => {};
    const catalog = (await listExercises(pool, actor)).exercises;
    assert.equal(catalog.length, 8);
    assert.deepEqual([...new Set(catalog.map((exercise) => exercise.mode))].sort(), [
      'bodyweight',
      'distance',
      'timed',
      'weighted',
    ]);
    const create = {
      type: 'task.create' as const,
      operationId: randomUUID(),
      taskId: randomUUID(),
      expectedRevision: 0 as const,
      content: { title: 'First task', description: 'Context', notes: 'Instructions' },
    };
    const first = await executeTaskCommand(pool, actor, create, authorize);
    assert.equal(first.task.phase, 'planned');
    await assert.rejects(
      pool.query("UPDATE tasks SET phase='completed' WHERE id=$1", [first.task.id]),
      /task_completion_matches_phase/,
    );
    assert.deepEqual(await executeTaskCommand(pool, actor, create, authorize), first);
    await assert.rejects(
      executeTaskCommand(
        pool,
        actor,
        { ...create, content: { ...create.content, title: 'Different' } },
        authorize,
      ),
      /operation ID/,
    );
    await assert.rejects(
      executeTaskCommand(pool, actor, create, async () => {
        throw new Error('revoked session');
      }),
      /revoked session/,
    );
    await assert.rejects(
      executeTaskCommand(pool, { ...actor, userId: 'unrelated-fixture' }, create, authorize),
      /own the installation/,
    );
    const second = await executeTaskCommand(
      pool,
      actor,
      {
        ...create,
        operationId: randomUUID(),
        taskId: randomUUID(),
        content: { ...create.content, title: 'Second task' },
      },
      authorize,
    );
    const third = await executeTaskCommand(
      pool,
      actor,
      {
        ...create,
        operationId: randomUUID(),
        taskId: randomUUID(),
        content: { ...create.content, title: 'Third task' },
      },
      authorize,
    );
    const reordered = await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.move',
        operationId: randomUUID(),
        taskId: third.task.id,
        expectedRevision: 1,
        phase: 'planned',
        beforeTaskId: first.task.id,
      },
      authorize,
    );
    assert.deepEqual(
      reordered.changedTasks.map((task) => task.content.title),
      ['Third task', 'First task', 'Second task'],
    );
    assert.deepEqual(
      (await listTasks(pool, actor)).tasks.map((task) => task.content.title),
      ['Third task', 'First task', 'Second task'],
    );
    assert.equal(reordered.changedTasks.find((task) => task.id === second.task.id)!.revision, 2);
    const grouped = await pool.query(
      'SELECT ordinal FROM change_feed WHERE operation_id=$1 ORDER BY ordinal',
      [reordered.operationId],
    );
    assert.deepEqual(
      grouped.rows.map((row) => row.ordinal),
      [0, 1, 2],
    );
    await assert.rejects(
      executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.edit',
          operationId: randomUUID(),
          taskId: first.task.id,
          expectedRevision: 1,
          content: create.content,
        },
        authorize,
      ),
      /changed/,
    );
    let current = (await readTask(pool, actor, first.task.id)).task;
    await assert.rejects(
      executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.move',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
          phase: 'active',
          beforeTaskId: null,
        },
        authorize,
      ),
      /Next/,
    );
    current = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.move',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
          phase: 'next',
          beforeTaskId: null,
        },
        authorize,
      )
    ).task;
    current = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.complete',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
        },
        authorize,
      )
    ).task;
    assert.ok(current.completedAt);
    assert.equal((await listTasks(pool, actor, 'completed')).tasks.length, 1);
    current = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.reopen',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
          phase: 'planned',
        },
        authorize,
      )
    ).task;
    assert.equal(current.completedAt, null);
    current = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.archive',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
        },
        authorize,
      )
    ).task;
    assert.equal(current.phase, 'planned');
    assert.equal((await listTasks(pool, actor, 'archived')).tasks.length, 1);
    current = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.delete',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
        },
        authorize,
      )
    ).task;
    assert.equal((await listTasks(pool, actor, 'archived')).tasks.length, 0);
    current = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.restore',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
        },
        authorize,
      )
    ).task;
    assert.ok(current.archivedAt);
    current = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.unarchive',
          operationId: randomUUID(),
          taskId: current.id,
          expectedRevision: current.revision,
        },
        authorize,
      )
    ).task;
    const history = TaskHistorySchema.parse(
      await taskHistory(pool, actor, current.id, undefined, 2),
    );
    assert.equal(history.events.length, 2);
    assert.ok(history.nextCursor);
    const older = await taskHistory(pool, actor, current.id, history.nextCursor!, 100);
    assert.ok(
      older.events.some((event) => event.type === 'task.complete' && event.task.completedAt),
    );
    const failure = {
      type: 'task.edit' as const,
      operationId: randomUUID(),
      taskId: current.id,
      expectedRevision: current.revision,
      content: { ...create.content, title: 'Failed write' },
    };
    const feedBefore = (await pool.query('SELECT feed_position FROM installation')).rows[0]
      .feed_position;
    await pool.query(
      "CREATE FUNCTION reject_feature_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='task.edit' THEN RAISE EXCEPTION 'injected feature failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_feature_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_feature_audit();",
    );
    await assert.rejects(
      executeTaskCommand(pool, actor, failure, authorize),
      /injected feature failure/,
    );
    assert.equal((await readTask(pool, actor, current.id)).task.revision, current.revision);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM operation_receipts WHERE operation_id=$1',
          [failure.operationId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await pool.query('SELECT feed_position FROM installation')).rows[0].feed_position,
      feedBefore,
    );
    await pool.query(
      'DROP TRIGGER reject_feature_audit ON audit_events; DROP FUNCTION reject_feature_audit()',
    );
    const concurrent = await Promise.allSettled(
      [0, 1].map(() =>
        executeTaskCommand(pool, actor, { ...failure, operationId: randomUUID() }, authorize),
      ),
    );
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    const custom = (
      await executeExerciseCommand(
        pool,
        actor,
        {
          type: 'exercise.create',
          operationId: randomUUID(),
          exerciseId: randomUUID(),
          expectedRevision: 0,
          content: { name: 'Custom lift', mode: 'weighted', supportsLoad: true, notes: 'Fixture' },
        },
        authorize,
      )
    ).exercise;
    const item = {
      id: randomUUID(),
      exerciseId: custom.id,
      snapshot: { name: custom.name, mode: custom.mode, supportsLoad: custom.supportsLoad },
      notes: '',
      targets: [
        {
          id: randomUUID(),
          kind: 'working' as const,
          measurements: { mode: 'weighted' as const, reps: 8, loadKg: 22.6796185 },
          notes: '',
        },
      ],
    };
    const mixedItems = [
      item,
      ...(['bodyweight', 'timed', 'distance'] as const).map((mode) => {
        const exercise = catalog.find((candidate) => candidate.mode === mode)!;
        const measurements =
          mode === 'bodyweight'
            ? { mode, reps: 10, addedLoadKg: null }
            : mode === 'timed'
              ? { mode, durationSeconds: 30, loadKg: null }
              : { mode, distanceMeters: 1000, durationSeconds: null, loadKg: null };
        return {
          id: randomUUID(),
          exerciseId: exercise.id,
          snapshot: {
            name: exercise.name,
            mode: exercise.mode,
            supportsLoad: exercise.supportsLoad,
          },
          notes: '',
          targets: [{ id: randomUUID(), kind: 'working' as const, measurements, notes: '' }],
        };
      }),
    ];
    const routineCreate = {
      type: 'routine.create' as const,
      operationId: randomUUID(),
      routineId: randomUUID(),
      expectedRevision: 0 as const,
      content: { name: 'Mixed plan', notes: 'Plan only', items: mixedItems },
    };
    const routine = (await executeRoutineCommand(pool, actor, routineCreate, authorize)).routine;
    assert.deepEqual(
      routine.items.map((value) => value.targets[0]!.measurements.mode),
      ['weighted', 'bodyweight', 'timed', 'distance'],
    );
    assert.deepEqual(routine.items[3]!.targets[0]!.measurements, {
      mode: 'distance',
      distanceMeters: 1000,
      durationSeconds: null,
      loadKg: null,
    });
    assert.deepEqual(await executeRoutineCommand(pool, actor, routineCreate, authorize), {
      operationId: routineCreate.operationId,
      routine,
      feedPosition: (await pool.query('SELECT feed_position FROM installation')).rows[0]
        .feed_position,
    });
    assert.equal(
      RoutineCommandSchema.safeParse({
        ...routineCreate,
        content: { ...routineCreate.content, items: [item, { ...item }] },
      }).success,
      false,
    );
    assert.equal(
      RoutineCommandSchema.safeParse({
        ...routineCreate,
        content: {
          ...routineCreate.content,
          items: [
            {
              ...item,
              targets: [
                {
                  ...item.targets[0],
                  measurements: { mode: 'timed', durationSeconds: 10, loadKg: null },
                },
              ],
            },
          ],
        },
      }).success,
      false,
    );
    await executeExerciseCommand(
      pool,
      actor,
      {
        type: 'exercise.edit',
        operationId: randomUUID(),
        exerciseId: custom.id,
        expectedRevision: 1,
        content: { name: 'Renamed lift', mode: 'weighted', supportsLoad: true, notes: '' },
      },
      authorize,
    );
    const edited = (
      await executeRoutineCommand(
        pool,
        actor,
        {
          type: 'routine.edit',
          operationId: randomUUID(),
          routineId: routine.id,
          expectedRevision: 1,
          content: { ...routineCreate.content, notes: 'Retain historical metadata' },
        },
        authorize,
      )
    ).routine;
    assert.equal(edited.items[0]!.snapshot.name, 'Custom lift');
    const archivedExercise = (
      await executeExerciseCommand(
        pool,
        actor,
        {
          type: 'exercise.archive',
          operationId: randomUUID(),
          exerciseId: custom.id,
          expectedRevision: 2,
        },
        authorize,
      )
    ).exercise;
    assert.ok(archivedExercise.archivedAt);
    await assert.rejects(
      executeRoutineCommand(
        pool,
        actor,
        { ...routineCreate, operationId: randomUUID(), routineId: randomUUID() },
        authorize,
      ),
      /exercise changed|archived/i,
    );
    const duplicate = (
      await executeRoutineCommand(
        pool,
        actor,
        {
          type: 'routine.duplicate',
          operationId: randomUUID(),
          routineId: edited.id,
          expectedRevision: edited.revision,
          newId: randomUUID(),
        },
        authorize,
      )
    ).routine;
    assert.notEqual(duplicate.items[0]!.id, item.id);
    assert.notEqual(duplicate.items[0]!.targets[0]!.id, item.targets[0]!.id);
    assert.deepEqual(duplicate.items[0]!.targets[0]!.measurements, item.targets[0]!.measurements);
    await executeRoutineCommand(
      pool,
      actor,
      {
        type: 'routine.archive',
        operationId: randomUUID(),
        routineId: edited.id,
        expectedRevision: edited.revision,
      },
      authorize,
    );
    assert.ok((await readRoutine(pool, actor, edited.id)).routine.archivedAt);
    assert.equal(
      (await readRoutine(pool, actor, edited.id)).routine.items[0]!.snapshot.name,
      'Custom lift',
    );
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS n FROM routine_exercises WHERE routine_id=$1', [
          duplicate.id,
        ])
      ).rows[0].n,
      4,
    );
    const service = await createApp(config, pool);
    try {
      assert.equal(
        (await service.app.inject({ method: 'GET', url: '/api/tasks' })).statusCode,
        401,
      );
      const signIn = await service.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: config.WEB_ORIGIN },
        payload: {
          email: 'feature-owner@example.test',
          password: 'fictional-feature-password-123',
        },
      });
      assert.equal(signIn.statusCode, 200, signIn.body);
      const cookies = signIn.headers['set-cookie'];
      const cookie = (Array.isArray(cookies) ? cookies : [cookies])
        .filter(Boolean)
        .map((value) => value!.split(';')[0])
        .join('; ');
      const headers = { cookie, origin: config.WEB_ORIGIN };
      assert.equal(
        (await service.app.inject({ method: 'GET', url: '/api/exercises', headers })).json()
          .exercises.length,
        8,
      );
      const unrelated = await service.auth.api.createUser({
        body: {
          email: 'unrelated-feature@example.test',
          name: 'Unrelated Fixture',
          password: 'fictional-feature-password-123',
        },
      });
      const otherLogin = await service.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: config.WEB_ORIGIN },
        payload: { email: unrelated.user.email, password: 'fictional-feature-password-123' },
      });
      const otherCookies = otherLogin.headers['set-cookie'];
      const otherCookie = (Array.isArray(otherCookies) ? otherCookies : [otherCookies])
        .filter(Boolean)
        .map((value) => value!.split(';')[0])
        .join('; ');
      assert.equal(
        (
          await service.app.inject({
            method: 'GET',
            url: '/api/tasks',
            headers: { cookie: otherCookie },
          })
        ).statusCode,
        403,
      );
      const foreignExerciseId = randomUUID();
      await pool.query(
        "INSERT INTO exercises(id,owner_id,revision,origin,content,created_at,updated_at) VALUES($1,$2,1,'custom',$3,now(),now())",
        [
          foreignExerciseId,
          unrelated.user.id,
          { name: 'Other owner fixture', mode: 'weighted', supportsLoad: true, notes: '' },
        ],
      );
      await assert.rejects(
        pool.query(
          'INSERT INTO routine_exercises(routine_id,item_id,exercise_id,ordinal,owner_id) VALUES($1,$2,$3,4,$4)',
          [duplicate.id, randomUUID(), foreignExerciseId, ownerId],
        ),
        /exercise_reference_owner/,
      );
      await assert.rejects(
        executeRoutineCommand(
          pool,
          actor,
          {
            ...routineCreate,
            operationId: randomUUID(),
            routineId: randomUUID(),
            content: {
              ...routineCreate.content,
              items: [{ ...item, exerciseId: foreignExerciseId }],
            },
          },
          authorize,
        ),
        /does not exist/,
      );

      assert.equal(
        (await service.app.inject({ method: 'GET', url: '/api/tasks?view=invalid', headers }))
          .statusCode,
        400,
      );
      assert.equal(
        (await service.app.inject({ method: 'GET', url: '/api/tasks/invalid', headers }))
          .statusCode,
        400,
      );
      const historyResponse = await service.app.inject({
        method: 'GET',
        url: `/api/tasks/${current.id}/history?limit=2`,
        headers,
      });
      assert.equal(historyResponse.statusCode, 200, historyResponse.body);
      assert.equal(TaskHistorySchema.parse(historyResponse.json()).events.length, 2);
      const httpCommand = { ...create, operationId: randomUUID(), taskId: randomUUID() };
      const response = await service.app.inject({
        method: 'POST',
        url: '/api/tasks/commands',
        headers,
        payload: httpCommand,
      });
      assert.equal(response.statusCode, 200, response.body);
      const replay = await service.app.inject({
        method: 'POST',
        url: '/api/tasks/commands',
        headers,
        payload: httpCommand,
      });
      assert.deepEqual(replay.json(), response.json());
      assert.equal(
        (
          await service.app.inject({
            method: 'POST',
            url: '/api/tasks/commands',
            headers: { cookie },
            payload: httpCommand,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await service.app.inject({
            method: 'POST',
            url: '/api/tasks/commands',
            headers,
            payload: { ...httpCommand, operationId: randomUUID(), unexpected: true },
          })
        ).statusCode,
        400,
      );
      await pool.query(
        'UPDATE session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',
        [ownerId],
      );
      assert.equal(
        (
          await service.app.inject({
            method: 'POST',
            url: '/api/tasks/commands',
            headers,
            payload: httpCommand,
          })
        ).statusCode,
        401,
      );
    } finally {
      await service.app.close();
    }
  } finally {
    await pool.end();
  }
});
