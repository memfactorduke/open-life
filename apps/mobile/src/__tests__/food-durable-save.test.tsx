import React from 'react';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { OfflineStore, type SqlExecutor, type SqlDatabase } from '../offline';
import { NativeOfflineClient } from '../offline-client';
import { Food } from '../features/Food';
import type { InstallationClient } from '../client';
import { uploadFoodPhoto } from '../media';
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID(),
}));
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('../offline/expo', () => ({ openOfflineStore: jest.fn() }));
jest.mock('../media', () => ({ uploadFoodPhoto: jest.fn(), retainFoodPhoto: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
const now = '2026-10-13T12:00:00.000Z';
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'food-save-'));
  const database = new DatabaseSync(join(folder, 'device.sqlite'));
  let fail = false;
  const executor: SqlExecutor = {
    exec: async (sql) => {
      database.exec(sql);
    },
    run: async (sql, ...params) => {
      if (fail && sql.startsWith('DELETE FROM offline_drafts')) throw new Error('SQLITE_FULL');
      database.prepare(sql).run(...params);
    },
    all: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      database.prepare(sql).all(...params) as T[],
  };
  let tail = Promise.resolve();
  const adapter: SqlDatabase = {
    ...executor,
    close: async () => database.close(),
    transaction: async (work) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(executor);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        release();
      }
    },
  };
  const store = new OfflineStore(adapter, { ownerId: randomUUID(), installationId: randomUUID() });
  await store.initialize();
  const entry = {
    id: randomUUID(),
    revision: 1,
    content: { text: 'Confirmed lunch', occurredAt: now, timezone: 'UTC' },
    photoIds: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await store.stageSnapshot({
    ...store.partition,
    schemaVersion: 1,
    epoch: randomUUID(),
    watermark: '0',
    snapshotId: randomUUID(),
    records: [{ recordType: 'food', id: entry.id, revision: 1, value: entry }],
    nextCursor: null,
  });
  const photo = {
    id: randomUUID(),
    entryId: entry.id,
    uri: 'file:///fixture/Documents/selected.jpg',
    size: 3,
    sha256: 'a'.repeat(64),
    operationId: randomUUID(),
  };
  const unselected = {
    ...photo,
    id: randomUUID(),
    uri: 'file:///fixture/Documents/unselected.jpg',
    operationId: randomUUID(),
  };
  await store.retainPhoto(photo);
  await store.retainPhoto(unselected);
  await store.setDraft('food-editor', {
    text: 'Selected lunch',
    time: now,
    draftEntryId: randomUUID(),
    selected: entry,
    photos: [photo],
  });
  const request = jest.fn();
  const base = {
    request,
    baseURL: 'https://fictional.example',
    auth: {},
  } as unknown as InstallationClient;
  const offline = new NativeOfflineClient(base, store);
  jest.spyOn(offline, 'sync').mockResolvedValue();
  const client = { ...base, offline, request: offline.request.bind(offline) };
  return {
    store,
    entry,
    photo,
    unselected,
    request,
    offline,
    client,
    fail: (v: boolean) => {
      fail = v;
    },
    close: async () => {
      await adapter.close();
      rmSync(folder, { recursive: true });
    },
  };
}
test('actual Food Save atomically queues selected retained photo; text acknowledgement unlocks normal upload', async () => {
  const f = await fixture();
  try {
    await f.offline.syncPhotos();
    expect(f.request).not.toHaveBeenCalled();
    await render(<Food client={f.client} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Food notes').props.value).toBe('Selected lunch'),
    );
    await fireEvent.press(screen.getByText('Save food entry'));
    await waitFor(() => expect(screen.getByText(/Saved on this device. Waiting/)).toBeTruthy());
    const photos = await f.store.photos();
    expect(photos.find((p) => p.id === f.photo.id)?.status).toBe('pending');
    expect(photos.find((p) => p.id === f.unselected.id)?.status).toBe('draft');
    const operation = (await f.store.outbox())[0];
    const savedCommand = JSON.parse(operation.payload);
    await f.store.setDraft('food-editor', { text: 'New unsaved editor' });
    await f.offline.saveFood(savedCommand, [f.unselected.uri]);
    expect((await f.store.photos()).find((p) => p.id === f.unselected.id)?.status).toBe('draft');
    expect((await f.store.getDraft<{ text: string }>('food-editor'))?.text).toBe(
      'New unsaved editor',
    );

    expect(JSON.parse(operation.payload).content.text).toBe('Selected lunch');
    await f.offline.syncPhotos();
    expect(f.request).not.toHaveBeenCalled();
    const confirmed = {
      ...f.entry,
      revision: 2,
      content: { ...f.entry.content, text: 'Selected lunch' },
    };
    await f.store.accept(operation.operationId, [
      { recordType: 'food', id: confirmed.id, revision: 2, value: confirmed },
    ]);
    const uploadId = randomUUID();
    f.request.mockImplementation(async (path: string) =>
      path.endsWith('/uploads')
        ? { upload: { id: uploadId, status: 'pending' } }
        : {
            operationId: f.photo.operationId,
            feedPosition: '1',
            entry: { ...confirmed, revision: 3, photoIds: [uploadId] },
          },
    );
    await act(async () => {
      await f.offline.syncPhotos();
    });
    expect(uploadFoodPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: f.photo.id,
        operationId: f.photo.operationId,
        uri: f.photo.uri,
      }),
      uploadId,
      expect.any(String),
    );
    expect((await f.store.photos()).find((p) => p.id === f.photo.id)?.status).toBe('synced');
    expect((await f.store.photos()).find((p) => p.id === f.unselected.id)?.status).toBe('draft');
    expect(f.request.mock.calls[0][1].operationId).toBe(f.photo.id);
    expect(f.request.mock.calls[1][1].operationId).toBe(f.photo.operationId);
  } finally {
    await f.close();
  }
});
test('failure after photo activation rolls back text, photos and draft; no acknowledgement or sync', async () => {
  const f = await fixture();
  try {
    f.fail(true);
    await expect(
      f.offline.saveFood(
        {
          type: 'food.edit',
          operationId: randomUUID(),
          entryId: f.entry.id,
          expectedRevision: 1,
          content: { ...f.entry.content, text: 'Failure draft' },
        },
        [f.photo.uri],
      ),
    ).rejects.toThrow('SQLITE_FULL');
    expect(await f.store.outbox()).toEqual([]);
    expect((await f.store.records('food'))[0].value).toEqual(f.entry);
    expect((await f.store.photos()).every((p) => p.status === 'draft')).toBe(true);
    expect((await f.store.getDraft<{ text: string }>('food-editor'))?.text).toBe('Selected lunch');
    expect(f.offline.sync).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
