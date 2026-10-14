import { DatabaseSync } from 'node:sqlite';
import { NativeOfflineClient } from '../offline-client';
import { OfflineStore, type SqlExecutor, type SqlDatabase } from '../offline';
import type { InstallationClient } from '../client';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('../offline/expo', () => ({ openOfflineStore: jest.fn() }));
jest.mock('../media', () => ({ uploadFoodPhoto: jest.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-13T12:00:00Z';
async function fixture() {
  const db = new DatabaseSync(':memory:');
  const tx: SqlExecutor = {
    exec: async (sql) => db.exec(sql),
    run: async (sql, ...params) => {
      db.prepare(sql).run(...params);
    },
    all: async <T>(sql: string, ...params: (string | number | null)[]) =>
      db.prepare(sql).all(...params) as T[],
  };
  let tail = Promise.resolve();
  const adapter: SqlDatabase = {
    ...tx,
    close: async () => db.close(),
    transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) => {
      const result = tail.then(async () => {
        db.exec('BEGIN');
        try {
          const value = await work(tx);
          db.exec('COMMIT');
          return value;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const store = new OfflineStore(adapter, {
    installationId: 'fictional-installation',
    ownerId: 'fictional-owner',
  });
  await store.initialize();
  await store.stageSnapshot({
    ...store.partition,
    schemaVersion: 1,
    epoch: 'epoch',
    watermark: '0',
    snapshotId: id(20),
    records: [],
    nextCursor: null,
  });
  const request = jest.fn();
  const base = {
    baseURL: 'https://fictional.example',
    request,
    auth: {},
  } as unknown as InstallationClient;
  const client = new NativeOfflineClient(base, store);
  jest.spyOn(client, 'sync').mockResolvedValue();
  return { store, client, request };
}
test('online routine create/edit is immediately visible through the durable cached list', async () => {
  const { store, client, request } = await fixture();
  const routine = {
    id: id(1),
    revision: 1,
    name: 'Fictional routine',
    notes: '',
    items: [],
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  request.mockResolvedValue({ operationId: id(2), feedPosition: '1', routine });
  await client.request(
    '/api/routines/commands',
    {
      type: 'routine.create',
      operationId: id(2),
      routineId: id(1),
      expectedRevision: 0,
      content: { name: routine.name, notes: '', items: [] },
    },
    'POST',
  );
  expect(await client.request('/api/routines')).toEqual({ routines: [routine] });
  const edited = { ...routine, revision: 2, name: 'Updated fictional routine' };
  request.mockResolvedValue({ operationId: id(3), feedPosition: '2', routine: edited });
  await client.request(
    '/api/routines/commands',
    {
      type: 'routine.edit',
      operationId: id(3),
      routineId: id(1),
      expectedRevision: 1,
      content: { name: edited.name, notes: '', items: [] },
    },
    'POST',
  );
  expect(await client.request('/api/routines')).toEqual({ routines: [edited] });
  await store.db.close();
});
test('online timer start/pause revisions feed the next queued finish exactly once', async () => {
  const { store, client, request } = await fixture();
  const session = {
    id: id(1),
    revision: 2,
    name: 'Fictional training',
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
  await store.ingestValidatedRecords([
    { recordType: 'session', id: session.id, revision: 2, value: session },
  ]);
  const timer = {
    id: id(9),
    kind: 'rest',
    state: 'running',
    durationSeconds: 90,
    remainingSeconds: 90,
    deadline: '2026-10-13T12:01:30Z',
    initiatingDeviceId: 'fictional-device',
    itemId: null,
    updatedAt: now,
    clockBasis: 'server',
  };
  request.mockResolvedValue({
    operationId: id(3),
    feedPosition: '3',
    session: { ...session, revision: 3, timer },
  });
  await client.request(
    '/api/sessions/commands',
    {
      type: 'session.timer-start',
      operationId: id(3),
      sessionId: session.id,
      expectedRevision: 2,
      timerId: id(9),
      kind: 'rest',
      durationSeconds: 90,
      initiatingDeviceId: 'fictional-device',
      itemId: null,
    },
    'POST',
  );
  const paused = {
    ...session,
    revision: 4,
    timer: { ...timer, state: 'paused', deadline: null, remainingSeconds: 89 },
  };
  request.mockResolvedValue({ operationId: id(4), feedPosition: '4', session: paused });
  await client.request(
    '/api/sessions/commands',
    { type: 'session.timer-pause', operationId: id(4), sessionId: session.id, expectedRevision: 3 },
    'POST',
  );
  expect(
    ((await client.request(`/api/sessions/${session.id}`)) as { session: unknown }).session,
  ).toEqual(paused);
  await client.request(
    '/api/sessions/commands',
    {
      type: 'session.finish',
      operationId: id(5),
      sessionId: session.id,
      expectedRevision: 4,
      occurredAt: '2026-10-13T12:02:00Z',
    },
    'POST',
  );
  expect(await store.outbox()).toHaveLength(1);
  expect((await store.records('session'))[0].value).toMatchObject({
    revision: 5,
    status: 'completed',
    timer: null,
  });
  expect(request).toHaveBeenCalledTimes(2);
  await store.db.close();
});

test.each(['restore', 'sign-out', 'reauth'] as const)(
  'online mutation acknowledgement after %s cannot contaminate the durable cache',
  async (invalidation) => {
    const { store, client, request } = await fixture();
    let release!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const sending = client.request(
      '/api/routines/commands',
      { type: 'routine.create', operationId: id(2), routineId: id(1) },
      'POST',
    );
    while (!release) await Promise.resolve();
    if (invalidation === 'restore') {
      await store.observeEpoch('restored');
      await store.stageSnapshot({
        ...store.partition,
        schemaVersion: 1,
        epoch: 'restored',
        watermark: '0',
        snapshotId: id(21),
        records: [],
        nextCursor: null,
      });
    } else {
      await store.signOut(true);
      if (invalidation === 'reauth') await store.signIn();
    }
    const rejected = expect(sending).rejects.toMatchObject({ code: 'ACK_REVIEW_REQUIRED' });
    release({
      operationId: id(2),
      feedPosition: '1',
      routine: {
        id: id(1),
        revision: 1,
        name: 'Old response',
        notes: '',
        items: [],
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await rejected;
    expect(await store.records('routine')).toEqual([]);
    await store.db.close();
  },
);
test('validated online task acknowledgement retains concurrent queued local content', async () => {
  const { store, client, request } = await fixture();
  const { applyTaskCommand, TaskCommandSchema } =
    jest.requireActual<typeof import('@mems-life/domain')>('@mems-life/domain');
  const original = applyTaskCommand(
    null,
    TaskCommandSchema.parse({
      type: 'task.create',
      operationId: id(2),
      taskId: id(1),
      expectedRevision: 0,
      content: { title: 'Original', description: '', notes: '' },
    }),
    now,
  );
  await store.ingestValidatedRecords([
    { recordType: 'task', id: original.id, revision: 1, value: original },
  ]);
  let release!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const sending = client.request(
    '/api/tasks/commands',
    { type: 'task.release', operationId: id(3), taskId: id(1), expectedRevision: 1 },
    'POST',
  );
  while (!release) await Promise.resolve();
  await store.save(
    TaskCommandSchema.parse({
      type: 'task.edit',
      operationId: id(4),
      taskId: id(1),
      expectedRevision: 1,
      content: { title: 'Retained local draft', description: '', notes: '' },
    }),
  );
  const remote = { ...original, revision: 2 };
  release({ operationId: id(3), feedPosition: '2', task: remote, changedTasks: [remote] });
  await sending;
  const cached = (await store.records('task'))[0];
  expect(cached.value).toMatchObject({ content: { title: 'Retained local draft' } });
  expect(cached.confirmed).toEqual(remote);
  expect((await store.outbox())[0]).toMatchObject({ operationId: id(4), state: 'never-sent' });
  await store.db.close();
});

test.each(['operation', 'entity'] as const)(
  'a shape-valid online acknowledgement with wrong %s leaves cached records, pending work and cursor unchanged',
  async (mismatch) => {
    const { store, client, request } = await fixture();
    const routine = {
      id: id(1),
      revision: 1,
      name: 'Original fictional routine',
      notes: '',
      items: [],
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await store.ingestValidatedRecords([
      { recordType: 'routine', id: routine.id, revision: 1, value: routine },
    ]);
    await store.save({
      type: 'food.create',
      operationId: id(10),
      entryId: id(11),
      expectedRevision: 0,
      content: { text: 'Pending fictional meal', occurredAt: now, timezone: 'UTC' },
    });
    const before = await store.exportPending();
    request.mockResolvedValue({
      operationId: mismatch === 'operation' ? id(99) : id(2),
      feedPosition: '999',
      routine: {
        ...routine,
        id: mismatch === 'entity' ? id(98) : routine.id,
        revision: 2,
        name: 'Must not install',
      },
    });
    await expect(
      client.request(
        '/api/routines/commands',
        {
          type: 'routine.edit',
          operationId: id(2),
          routineId: id(1),
          expectedRevision: 1,
          content: { name: 'Edited', notes: '', items: [] },
        },
        'POST',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ACK' });
    expect(await store.exportPending()).toBe(before);
    expect((await store.state()).cursor).toBe('0');
    expect((await store.outbox())[0]).toMatchObject({ operationId: id(10), state: 'never-sent' });
    await store.db.close();
  },
);
test('routine duplication binds acknowledgement to the new identity rather than the source routine', async () => {
  const { store, client, request } = await fixture();
  const routine = {
    id: id(1),
    revision: 1,
    name: 'Original fictional routine',
    notes: '',
    items: [],
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await store.ingestValidatedRecords([
    { recordType: 'routine', id: routine.id, revision: 1, value: routine },
  ]);
  const body = {
    type: 'routine.duplicate',
    operationId: id(2),
    routineId: id(1),
    newId: id(3),
    expectedRevision: 1,
  };
  request.mockResolvedValue({ operationId: id(2), feedPosition: '1', routine });
  await expect(client.request('/api/routines/commands', body, 'POST')).rejects.toMatchObject({
    code: 'INVALID_ACK',
  });
  const duplicated = { ...routine, id: id(3), name: 'Copied fictional routine' };
  request.mockResolvedValue({ operationId: id(2), feedPosition: '1', routine: duplicated });
  await client.request('/api/routines/commands', body, 'POST');
  expect((await store.records('routine')).map((record) => record.value)).toEqual([
    routine,
    duplicated,
  ]);
  expect((await store.state()).cursor).toBe('0');
  await store.db.close();
});
