import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { nextOccurrence, type RecurrenceRule } from '@mems-life/domain';
import { migrate, bootstrapOwner } from '../src/database.js';
import { migrateProductivity } from '../src/productivity-migrations.js';
import { requireOwner } from '../src/operations.js';
import { readConfig } from '../src/config.js';
import { executeTaskCommand, queryTasks, taskHistory } from '../src/tasks.js';
import { executeBoardCommand, executeProjectCommand } from '../src/organization.js';
import { executeStepCommand, listSteps } from '../src/steps.js';
import { executeRecurrenceCommand } from '../src/recurrence.js';
const databaseUrl =
  process.env.PRODUCTIVITY_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_productivity_test';
if (new URL(databaseUrl).pathname !== '/mems_life_productivity_test')
  throw new Error('Productivity tests require isolated mems_life_productivity_test.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-productivity-secret-minimum-length',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
const content = { title: 'Fictional workflow', description: 'Branches', notes: 'Review' };
const rule: RecurrenceRule = {
  frequency: 'monthly',
  timeZone: 'America/New_York',
  time: '02:30',
  startDate: '2026-01-01',
  weekdays: [],
  monthDay: 31,
};
test('calendar boundaries use last valid day, spring gap later and autumn earlier offset', () => {
  assert.equal(nextOccurrence(rule, '2026-01-31T08:00:00Z').at, '2026-02-28T07:30:00Z');
  assert.equal(
    nextOccurrence({ ...rule, frequency: 'daily' }, '2026-03-08T05:00:00Z').at,
    '2026-03-08T07:30:00Z',
  );
  assert.equal(
    nextOccurrence({ ...rule, frequency: 'daily', time: '01:30' }, '2026-11-01T04:00:00Z').at,
    '2026-11-01T05:30:00Z',
  );
});
test('PostgreSQL organization, planned safety, graph, completion, receipts and recurrence history', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateProductivity(pool);
    await migrateProductivity(pool);
    await bootstrapOwner(pool, config, {
      email: 'productivity@example.test',
      name: 'Productivity Fixture',
      password: 'fictional-password-1234',
    });
    const owner = (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id;
    const actor = await requireOwner(pool, owner);
    const auth = async () => {};
    const boardId = randomUUID(),
      projectId = randomUUID(),
      columns = ['planned', 'next', 'active'].map((phase) => ({
        id: randomUUID(),
        name: phase,
        phase: phase as 'planned' | 'next' | 'active',
      }));
    columns.push({ id: randomUUID(), name: 'Later plans', phase: 'planned' });
    const board = await executeBoardCommand(
      pool,
      actor,
      {
        type: 'board.create',
        id: boardId,
        expectedRevision: 0,
        operationId: randomUUID(),
        content: { name: 'Home', columns },
      },
      auth,
    );
    await executeProjectCommand(
      pool,
      actor,
      {
        type: 'project.create',
        id: projectId,
        expectedRevision: 0,
        operationId: randomUUID(),
        content: { name: 'Fictional Project', description: '' },
      },
      auth,
    );
    let task = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.create',
          taskId: randomUUID(),
          expectedRevision: 0,
          operationId: randomUUID(),
          content,
        },
        auth,
      )
    ).task;
    task = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.organize',
          taskId: task.id,
          expectedRevision: task.revision,
          operationId: randomUUID(),
          organization: {
            boardId,
            columnId: columns[0]!.id,
            projectId,
            tags: ['home'],
            priority: 'high',
          },
        },
        auth,
      )
    ).task;
    await executeBoardCommand(
      pool,
      actor,
      {
        type: 'board.edit',
        id: boardId,
        expectedRevision: board.record.revision,
        operationId: randomUUID(),
        content: {
          name: 'Renamed',
          columns: columns.map((c) => ({ ...c, name: 'Custom ' + c.name })),
        },
      },
      auth,
    );
    assert.equal(task.phase, 'planned');
    assert.equal(
      (await queryTasks(pool, actor, { search: 'Fictional', tag: 'home', projectId })).tasks.length,
      1,
    );
    const firstId = randomUUID(),
      secondId = randomUUID();
    const stepContent = {
      title: 'First',
      instructions: 'Do work',
      required: true,
      responsibility: 'human' as const,
      dependencies: [] as string[],
      order: 0,
    };
    let result = await executeStepCommand(
      pool,
      actor,
      {
        type: 'step.create',
        operationId: randomUUID(),
        id: firstId,
        taskId: task.id,
        expectedRevision: 0,
        expectedTaskRevision: task.revision,
        content: stepContent,
      },
      auth,
    );
    task = result.task;
    result = await executeStepCommand(
      pool,
      actor,
      {
        type: 'step.create',
        operationId: randomUUID(),
        id: secondId,
        taskId: task.id,
        expectedRevision: 0,
        expectedTaskRevision: task.revision,
        content: {
          ...stepContent,
          title: 'Agent branch',
          responsibility: 'agent',
          dependencies: [firstId],
          order: 1,
        },
      },
      auth,
    );
    task = result.task;
    assert.equal(result.nextActions.length, 0);
    assert.equal(result.entries[0]!.waitingReason, 'not_released');
    await assert.rejects(
      executeStepCommand(
        pool,
        actor,
        {
          type: 'step.edit',
          operationId: randomUUID(),
          id: firstId,
          taskId: task.id,
          expectedRevision: 1,
          expectedTaskRevision: task.revision,
          content: { ...stepContent, dependencies: [secondId] },
        },
        auth,
      ),
      /cycle/,
    );
    await assert.rejects(
      executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.complete',
          operationId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
        },
        auth,
      ),
      /required steps/,
    );
    task = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.move',
          operationId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          phase: 'next',
          beforeTaskId: null,
        },
        auth,
      )
    ).task;
    assert.deepEqual((await listSteps(pool, actor, task.id)).nextActions, [firstId]);
    result = await executeStepCommand(
      pool,
      actor,
      {
        type: 'step.status',
        operationId: randomUUID(),
        id: firstId,
        taskId: task.id,
        expectedRevision: 1,
        expectedTaskRevision: task.revision,
        status: 'completed',
      },
      auth,
    );
    task = result.task;
    assert.deepEqual(result.nextActions, [secondId]);
    result = await executeStepCommand(
      pool,
      actor,
      {
        type: 'step.status',
        operationId: randomUUID(),
        id: secondId,
        taskId: task.id,
        expectedRevision: 1,
        expectedTaskRevision: task.revision,
        status: 'completed',
      },
      auth,
    );
    task = result.task;
    task = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.review',
          operationId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          required: true,
          satisfied: false,
        },
        auth,
      )
    ).task;
    await assert.rejects(
      executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.complete',
          operationId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
        },
        auth,
      ),
      /final review/,
    );
    task = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.review',
          operationId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          required: true,
          satisfied: true,
        },
        auth,
      )
    ).task;
    const completion = {
      type: 'task.complete' as const,
      operationId: randomUUID(),
      taskId: task.id,
      expectedRevision: task.revision,
    };
    const completed = await executeTaskCommand(pool, actor, completion, auth);
    assert.deepEqual(await executeTaskCommand(pool, actor, completion, auth), completed);
    await assert.rejects(
      executeTaskCommand(pool, actor, completion, async () => {
        throw Error('revoked');
      }),
      /revoked/,
    );
    const history = await taskHistory(pool, actor, task.id);
    assert.ok(history.events.length >= 7);
    const raceTask = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.create',
          taskId: randomUUID(),
          expectedRevision: 0,
          operationId: randomUUID(),
          content,
        },
        auth,
      )
    ).task;
    const races = await Promise.allSettled(
      ['One', 'Two'].map((title) =>
        executeTaskCommand(
          pool,
          actor,
          {
            type: 'task.edit',
            taskId: raceTask.id,
            expectedRevision: raceTask.revision,
            operationId: randomUUID(),
            content: { ...content, title },
          },
          auth,
        ),
      ),
    );
    assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(races.filter((r) => r.status === 'rejected').length, 1);
    await assert.rejects(
      executeStepCommand(
        pool,
        actor,
        {
          type: 'step.create',
          operationId: randomUUID(),
          id: randomUUID(),
          taskId: raceTask.id,
          expectedRevision: 0,
          expectedTaskRevision: 2,
          content: { ...stepContent, dependencies: [firstId] },
        },
        auth,
      ),
      /this parent/,
    );
    await assert.rejects(
      queryTasks(pool, { ...actor, userId: 'unrelated-fixture' }, {}),
      /own the installation/,
    );
    const seriesId = randomUUID();
    let recurring = await executeRecurrenceCommand(
      pool,
      actor,
      {
        type: 'series.create',
        operationId: randomUUID(),
        id: seriesId,
        expectedRevision: 0,
        content,
        rule: { ...rule, frequency: 'weekly', weekdays: [1, 3] },
      },
      auth,
    );
    assert.equal(recurring.changedTasks.length, 1);
    const occurrence = recurring.changedTasks[0]!;
    const skip = {
      type: 'series.skip' as const,
      operationId: randomUUID(),
      id: seriesId,
      expectedRevision: 1,
      taskId: occurrence.id,
      expectedTaskRevision: 1,
    };
    recurring = await executeRecurrenceCommand(pool, actor, skip, auth);
    assert.equal(recurring.changedTasks.length, 2);
    assert.deepEqual(await executeRecurrenceCommand(pool, actor, skip, auth), recurring);
    await executeRecurrenceCommand(
      pool,
      actor,
      { type: 'series.cancel', operationId: randomUUID(), id: seriesId, expectedRevision: 1 },
      auth,
    );
    assert.equal((await queryTasks(pool, actor, { view: 'archived' })).tasks.length, 2);
    const lateSeries = await executeRecurrenceCommand(
      pool,
      actor,
      {
        type: 'series.create',
        operationId: randomUUID(),
        id: randomUUID(),
        expectedRevision: 0,
        content,
        rule: { ...rule, frequency: 'daily' },
      },
      auth,
    );
    const lateTask = lateSeries.changedTasks[0]!;
    await pool.query(
      "UPDATE tasks SET schedule=jsonb_set(jsonb_set(jsonb_set(schedule,'{occurrenceKey}',to_jsonb('2020-01-01T02:30[America/New_York]'::text)),'{dueAt}',to_jsonb('2020-01-01T07:30:00Z'::text)),'{scheduledAt}',to_jsonb('2020-01-01T07:30:00Z'::text)) WHERE id=$1",
      [lateTask.id],
    );
    const lateComplete = {
      type: 'task.complete' as const,
      operationId: randomUUID(),
      taskId: lateTask.id,
      expectedRevision: 1,
    };
    const late = await executeTaskCommand(pool, actor, lateComplete, auth);
    assert.equal(
      late.changedTasks.filter((t) => t.schedule.seriesId === lateTask.schedule.seriesId).length,
      2,
    );
    assert.deepEqual(await executeTaskCommand(pool, actor, lateComplete, auth), late);
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS count FROM tasks WHERE series_id=$1', [
          lateTask.schedule.seriesId,
        ])
      ).rows[0].count,
      2,
    );
    assert.ok(
      Date.parse(late.changedTasks.find((t) => t.id !== lateTask.id)!.schedule.scheduledAt!) >
        Date.now(),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE event_type='series.skip'",
        )
      ).rows[0].count,
      1,
    );
    async function createInColumn(columnId: string) {
      let created = (
        await executeTaskCommand(
          pool,
          actor,
          {
            type: 'task.create',
            operationId: randomUUID(),
            taskId: randomUUID(),
            expectedRevision: 0,
            content,
          },
          auth,
        )
      ).task;
      created = (
        await executeTaskCommand(
          pool,
          actor,
          {
            type: 'task.organize',
            operationId: randomUUID(),
            taskId: created.id,
            expectedRevision: created.revision,
            organization: { boardId, columnId, projectId: null, tags: [], priority: 'none' },
          },
          auth,
        )
      ).task;
      return created;
    }
    const otherLane = await createInColumn(columns[0]!.id);
    const secondLaneA = await createInColumn(columns[3]!.id);
    const secondLaneB = await createInColumn(columns[3]!.id);
    const secondLaneReordered = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.move',
          operationId: randomUUID(),
          taskId: secondLaneB.id,
          expectedRevision: secondLaneB.revision,
          phase: 'planned',
          beforeTaskId: secondLaneA.id,
        },
        auth,
      )
    ).task;
    assert.equal(secondLaneReordered.organization.columnId, columns[3]!.id);
    assert.equal(secondLaneReordered.order, 0);
    assert.equal(
      (await pool.query('SELECT revision FROM tasks WHERE id=$1', [otherLane.id])).rows[0].revision,
      otherLane.revision,
    );
    await assert.rejects(
      executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.move',
          operationId: randomUUID(),
          taskId: secondLaneReordered.id,
          expectedRevision: secondLaneReordered.revision,
          phase: 'planned',
          beforeTaskId: otherLane.id,
        },
        auth,
      ),
      /destination task.*column/,
    );
    const scheduledOnly = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.schedule',
          operationId: randomUUID(),
          taskId: otherLane.id,
          expectedRevision: otherLane.revision,
          dueAt: null,
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        },
        auth,
      )
    ).task;
    assert(
      (await queryTasks(pool, actor, { timing: 'upcoming' })).tasks.some(
        (item) => item.id === scheduledOnly.id,
      ),
    );
    assert(
      !(await queryTasks(pool, actor, { timing: 'overdue' })).tasks.some(
        (item) => item.id === scheduledOnly.id,
      ),
    );
  } finally {
    await pool.end();
  }
});
