import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SyncStatus } from '../SyncStatus';
import type { InstallationClient } from '../client';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('../offline/expo', () => ({ openOfflineStore: jest.fn() }));
jest.mock('../offline/photo-export', () => ({
  shareRetainedPhoto: jest.fn(),
  exportRecoveryFiles: jest.fn(),
}));
jest.mock('../media', () => ({ uploadFoodPhoto: jest.fn() }));
function client(state: unknown, pending: unknown[], photos: unknown[] = []) {
  return {
    offline: {
      subscribe: () => () => {},
      snapshot: () => 0,
      error: '',
      needsSignIn: false,
      store: {
        state: async () => state,
        outbox: async () => pending,
        records: async () => [],
        photos: async () => photos,
      },
    },
  } as unknown as InstallationClient;
}
test('local queued saves are distinct from server confirmation', async () => {
  render(
    <SyncStatus
      client={client({ epoch: 'fictional', replayPaused: false }, [
        { operationId: 'op', state: 'never-sent' },
      ])}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByText('Saved on this device · 1 changes and 0 photos pending server confirmation'),
    ).toBeTruthy(),
  );
  expect(screen.queryByText('Server confirmed · saved changes are synchronized')).toBeNull();
});
test('photo staging is pending even after the diary record was acknowledged', async () => {
  render(
    <SyncStatus
      client={client({ epoch: 'fictional', replayPaused: false }, [], [{ status: 'pending' }])}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByText('Saved on this device · 0 changes and 1 photos pending server confirmation'),
    ).toBeTruthy(),
  );
});
test('a server restore clearly pauses replay', async () => {
  render(<SyncStatus client={client({ epoch: 'fictional', replayPaused: true }, [])} />);
  await waitFor(() => expect(screen.getByText(/The server was restored/)).toBeTruthy());
});

test('requires a current outcome check before offering reviewed resubmission', async () => {
  const local = {
    content: { text: 'Fictional local lunch', occurredAt: '2026-10-13T12:00:00.000Z' },
    photoIds: [],
    revision: 2,
  };
  const server = {
    ...local,
    content: { ...local.content, text: 'Fictional server lunch' },
    revision: 3,
  };
  const record = { recordType: 'food', id: 'fixture', value: local, confirmed: server };
  const instance = client({ epoch: 'restored', replayPaused: true }, [
    { operationId: 'op', aggregate: 'food:fixture', state: 'review', attempts: 1, error: null },
  ]);
  const offline = instance.offline!;
  offline.store.records = jest.fn().mockResolvedValue([record]);
  offline.notify = jest.fn();
  offline.checkRecovery = jest.fn().mockResolvedValue({
    epoch: 'restored',
    revision: 3,
    originalSaved: false,
    outcomeChecked: false,
    record,
  });
  offline.saveReviewed = jest.fn().mockResolvedValue(record);
  render(<SyncStatus client={instance} />);
  await waitFor(() =>
    expect(screen.getAllByText(/Fictional local lunch/).length).toBeGreaterThan(0),
  );
  expect(screen.queryByText('I checked: submit my reviewed change')).toBeNull();
  fireEvent.press(screen.getByText('Check the current server and original attempt'));
  await waitFor(() =>
    expect(screen.getByText('I checked: submit my reviewed change')).toBeTruthy(),
  );
  fireEvent.press(screen.getByText('I checked: submit my reviewed change'));
  await waitFor(() =>
    expect(offline.saveReviewed).toHaveBeenCalledWith(
      'op',
      expect.objectContaining({ epoch: 'restored', revision: 3, outcomeChecked: true }),
    ),
  );
});
test('shows a saved image recovery choice without offering another upload', async () => {
  const instance = client(
    { epoch: 'restored', replayPaused: true },
    [],
    [{ id: 'photo', uri: 'file:///Documents/fixture.jpg', status: 'needs-attention', attempts: 1 }],
  );
  instance.offline!.notify = jest.fn();
  instance.offline!.checkPhotoRecovery = jest.fn().mockResolvedValue({
    epoch: 'restored',
    matchingId: 'saved-media',
    entryExists: true,
    text: 'Fictional lunch',
    photoCount: 1,
  });
  instance.offline!.recoverPhoto = jest.fn();
  render(<SyncStatus client={instance} />);
  await waitFor(() =>
    expect(screen.getByText('Check current entry and saved photos')).toBeTruthy(),
  );
  fireEvent.press(screen.getByText('Check current entry and saved photos'));
  await waitFor(() => expect(screen.getByText('Use the already saved image')).toBeTruthy());
  expect(screen.queryByText('I checked: save as a new photo')).toBeNull();
  fireEvent.press(screen.getByText('Use the already saved image'));
  await waitFor(() =>
    expect(instance.offline!.recoverPhoto).toHaveBeenCalledWith(
      'photo',
      expect.objectContaining({ matchingId: 'saved-media' }),
    ),
  );
});

test('orphan photo recovery shows retained text and requires separate acknowledged-text and photo choices', async () => {
  const retainedEntry = {
    id: 'old-entry',
    revision: 1,
    content: {
      text: 'Fictional retained meal',
      occurredAt: '2026-10-13T12:00:00Z',
      timezone: 'UTC',
    },
    photoIds: [],
    createdAt: '2026-10-13T12:00:00Z',
    updatedAt: '2026-10-13T12:00:00Z',
    deletedAt: null,
  };
  const photo = {
    id: 'orphan-photo',
    entryId: 'old-entry',
    status: 'needs-attention',
    uri: 'file:///fictional/Documents/meal.jpg',
    size: 40,
    sha256: 'a'.repeat(64),
    attempts: 0,
  };
  const instance = client({ epoch: 'restored', replayPaused: true }, [], [photo]);
  const offline = instance.offline!;
  offline.notify = jest.fn();
  const proof = {
    epoch: 'restored',
    entryExists: false,
    text: 'Food entry',
    photoCount: 0,
    retainedEntry,
    targetId: 'old-entry',
  };
  offline.checkPhotoRecovery = jest
    .fn()
    .mockResolvedValueOnce(proof)
    .mockResolvedValueOnce({
      ...proof,
      entryExists: true,
      recoveryEntryId: 'new-entry',
      targetId: 'new-entry',
      text: retainedEntry.content.text,
    });
  offline.recoverPhoto = jest.fn().mockResolvedValue(undefined);
  render(<SyncStatus client={instance} />);
  await waitFor(() =>
    expect(screen.getByText('Check current entry and saved photos')).toBeTruthy(),
  );
  expect(screen.queryByText('Create new diary entry from retained details')).toBeNull();
  fireEvent.press(screen.getByText('Check current entry and saved photos'));
  await waitFor(() =>
    expect(screen.getByText(/Retained diary details: Fictional retained meal/)).toBeTruthy(),
  );
  expect(screen.queryByText(/bytes · SHA-256/)).toBeNull();
  fireEvent.press(screen.getByText('Create new diary entry from retained details'));
  await waitFor(() =>
    expect(offline.recoverPhoto).toHaveBeenCalledWith('orphan-photo', proof, false, true),
  );
  await waitFor(() => expect(screen.getByText('Save this never-sent photo')).toBeTruthy());
  expect(offline.recoverPhoto).toHaveBeenCalledTimes(1);
});

test('later diary review displays immutable command text after earlier acknowledgement changes projection', async () => {
  const occurredAt = '2026-10-13T12:00:00Z';
  const intermediate = {
    content: { text: 'First reviewed edit', occurredAt },
    photoIds: [],
    revision: 2,
  };
  const instance = client({ epoch: 'restored', replayPaused: true }, [
    {
      operationId: 'later',
      aggregate: 'food:fixture',
      state: 'review',
      attempts: 0,
      payload: JSON.stringify({
        type: 'food.edit',
        content: { text: 'Last retained edit', occurredAt },
      }),
    },
  ]);
  instance.offline!.store.records = jest
    .fn()
    .mockResolvedValue([
      { recordType: 'food', id: 'fixture', value: intermediate, confirmed: intermediate },
    ]);
  render(<SyncStatus client={instance} />);
  await waitFor(() => expect(screen.getByText(/On this device: Last retained edit/)).toBeTruthy());
  expect(screen.getByText(/On the server: First reviewed edit/)).toBeTruthy();
});

test('later schedule and workout commands compare their immutable target values', () => {
  const { reviewCommandDifferences } =
    jest.requireActual<typeof import('../offline/recovery')>('../offline/recovery');
  const { TaskCommandSchema, SessionCommandSchema } =
    jest.requireActual<typeof import('@mems-life/domain')>('@mems-life/domain');
  const id = '00000000-0000-4000-8000-000000000001';
  const itemId = '00000000-0000-4000-8000-000000000002';
  const setId = '00000000-0000-4000-8000-000000000003';
  const due = '2026-10-20T12:00:00.000Z';
  const schedule = TaskCommandSchema.parse({
    type: 'task.schedule',
    operationId: id,
    taskId: id,
    expectedRevision: 2,
    dueAt: due,
    scheduledAt: null,
  });
  expect(
    reviewCommandDifferences(schedule, { schedule: { dueAt: null } }, []).find(
      (field) => field.field === 'Due',
    ),
  ).toEqual({
    field: 'Due',
    local: new Date(due).toLocaleString(),
    server: 'Not set',
    changed: true,
  });
  const server = {
    notes: 'Server workout notes',
    items: [
      {
        id: itemId,
        snapshot: { name: 'Fictional press' },
        notes: 'Server exercise notes',
        results: [
          {
            id: setId,
            kind: 'working',
            measurements: { mode: 'weighted', reps: 4, loadKg: 10 },
            notes: 'Earlier set notes',
            round: null,
          },
        ],
      },
    ],
  };
  const set = SessionCommandSchema.parse({
    type: 'session.record-set',
    operationId: id,
    sessionId: id,
    expectedRevision: 2,
    itemId,
    setId,
    kind: 'working',
    measurements: { mode: 'weighted', reps: 9, loadKg: 25 },
    notes: 'Later immutable set notes',
    round: null,
  });
  const fields = reviewCommandDifferences(set, server, []);
  expect(fields.find((field) => field.field === 'Measurements')).toEqual({
    field: 'Measurements',
    local: '9 reps, 25 kg',
    server: '4 reps, 10 kg',
    changed: true,
  });
  expect(fields.find((field) => field.field === 'Set notes')?.local).toBe(
    'Later immutable set notes',
  );
  const notes = SessionCommandSchema.parse({
    type: 'session.set-notes',
    operationId: id,
    sessionId: id,
    expectedRevision: 2,
    itemId,
    notes: 'Later immutable exercise notes',
  });
  expect(
    reviewCommandDifferences(notes, server, []).find((field) => field.field === 'Notes'),
  ).toEqual({
    field: 'Notes',
    local: 'Later immutable exercise notes',
    server: 'Server exercise notes',
    changed: true,
  });
});

test('healthy compact status stays quiet without hydrating local history', async () => {
  const instance = client({ epoch: 'fictional', replayPaused: false }, []);
  const store = instance.offline!.store;
  store.syncSummary = jest.fn().mockResolvedValue({
    pendingChangeCount: 0,
    pendingPhotoCount: 0,
    reviewChangeCount: 0,
    reviewPhotoCount: 0,
  });
  store.outbox = jest.fn();
  store.records = jest.fn();
  store.photos = jest.fn();
  await render(<SyncStatus client={instance} compact onOpen={jest.fn()} />);
  await waitFor(() => expect(store.syncSummary).toHaveBeenCalled());
  expect(screen.queryByRole('button')).toBeNull();
  expect(store.outbox).not.toHaveBeenCalled();
  expect(store.records).not.toHaveBeenCalled();
  expect(store.photos).not.toHaveBeenCalled();
});
test.each([
  {
    pendingChangeCount: 2,
    pendingPhotoCount: 1,
    reviewChangeCount: 0,
    reviewPhotoCount: 0,
    title: '3 items waiting to sync',
  },
  {
    pendingChangeCount: 0,
    pendingPhotoCount: 1,
    reviewChangeCount: 0,
    reviewPhotoCount: 1,
    title: 'Saved changes need review',
  },
])(
  'compact status keeps unsent work and photo recovery reachable: $title',
  async ({ title, ...counts }) => {
    const instance = client({ epoch: 'fictional', replayPaused: false }, []);
    instance.offline!.store.syncSummary = jest.fn().mockResolvedValue(counts);
    const open = jest.fn();
    await render(<SyncStatus client={instance} compact onOpen={open} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `${title}. Open sync and recovery` })).toBeTruthy(),
    );
    await fireEvent.press(screen.getByRole('button', { name: `${title}. Open sync and recovery` }));
    expect(open).toHaveBeenCalledTimes(1);
  },
);
