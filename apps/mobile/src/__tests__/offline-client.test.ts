import { NativeOfflineClient, parseFoodAcknowledgement } from '../offline-client';
import type { InstallationClient } from '../client';
import type { OfflineStore, OfflineCommand } from '../offline';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('../offline/expo', () => ({ openOfflineStore: jest.fn() }));
jest.mock('../media', () => ({ uploadFoodPhoto: jest.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-12T12:00:00Z';
const entry = {
  id: id(1),
  revision: 1,
  content: { text: 'Fictional lunch', occurredAt: now, timezone: 'America/New_York' },
  photoIds: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const create = {
  type: 'food.create',
  operationId: id(2),
  entryId: id(1),
  expectedRevision: 0,
  content: entry.content,
} as OfflineCommand;
function fixture() {
  const request = jest.fn().mockRejectedValue(new Error('Network unavailable'));
  const base = {
    baseURL: 'https://fictional.example',
    request,
    auth: {},
  } as unknown as InstallationClient;
  const store = {
    save: jest.fn().mockResolvedValue({
      recordType: 'food',
      id: id(1),
      revision: 1,
      value: entry,
      status: 'pending',
    }),
    state: jest.fn().mockResolvedValue({ epoch: id(4), signedOut: false, replayPaused: false }),
    records: jest.fn().mockResolvedValue([
      {
        recordType: 'food',
        id: id(1),
        revision: 1,
        value: entry,
        status: 'pending',
        confirmed: null,
      },
    ]),
    photos: jest.fn().mockResolvedValue([]),
    ingestValidatedRecords: jest.fn(),
  } as unknown as OfflineStore;
  const client = new NativeOfflineClient(base, store);
  jest.spyOn(client, 'sync').mockResolvedValue();
  return { client, store, request };
}
test('local acknowledgement follows durable save and carries no server feed position', async () => {
  const { client, store, request } = fixture();
  const result = await client.request('/api/food/commands', create, 'POST');
  expect(store.save).toHaveBeenCalledWith(create, {});
  expect(result).toEqual({ localSaved: true, operationId: id(2), record: entry });
  expect(parseFoodAcknowledgement(result).entry).toEqual(entry);
  expect(request).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty('feedPosition');
});
test('disk failure is not acknowledged and does not start synchronization', async () => {
  const { client, store } = fixture();
  jest.mocked(store.save).mockRejectedValue(new Error('SQLITE_FULL'));
  await expect(client.request('/api/food/commands', create, 'POST')).rejects.toThrow('SQLITE_FULL');
  expect(client.sync).not.toHaveBeenCalled();
});
test('downloaded projection can be read immediately without network and matches local date', async () => {
  const { client, request } = fixture();
  await expect(
    client.request('/api/food?date=2026-10-12&timezone=America%2FNew_York'),
  ).resolves.toEqual({ entries: [entry] });
  expect(request).not.toHaveBeenCalled();
  await expect(
    client.request('/api/food?date=2026-10-11&timezone=America%2FNew_York'),
  ).resolves.toEqual({ entries: [] });
});
test('agent-sensitive actions use authenticated online transport and never enqueue', async () => {
  const { client, request, store } = fixture();
  await expect(
    client.request('/api/tasks/commands', { type: 'task.complete' }, 'POST'),
  ).rejects.toThrow('Network unavailable');
  expect(request).toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});
test('malformed server success cannot pass the strict server acknowledgement parser', () => {
  expect(() => parseFoodAcknowledgement({ operationId: id(2), entry })).toThrow();
});

test('a local save during an active sync requests another pass before the returned sync settles', async () => {
  const { client } = fixture();
  jest.mocked(client.sync).mockRestore();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = jest
    .spyOn(client.coordinator, 'sync')
    .mockImplementationOnce(() => held)
    .mockResolvedValue();
  const sync = client.sync();
  await client.save(create);
  release();
  await sync;
  expect(coordinator).toHaveBeenCalledTimes(2);
});
