import {
  reconcileDueNotifications,
  registerRemoteNotifications,
  clearNotificationsOnLogout,
  notificationResponseRoute,
  resolveNotificationResponse,
} from '../src/notifications';
import { TaskSchema, type AttentionResponse } from '@mems-life/domain';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
const now = '2026-10-13T12:00:00.000Z',
  id = '22222222-2222-4222-8222-222222222222';
const task = TaskSchema.parse({
  id,
  revision: 1,
  phase: 'next',
  content: { title: 'Private fictional task', description: '', notes: '' },
  order: 0,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  archivedAt: null,
  deletedAt: null,
  schedule: { dueAt: '2026-10-13T14:00:00.000Z' },
});
const attention: AttentionResponse = {
  now,
  timezone: 'UTC',
  date: '2026-10-13',
  activeSession: null,
  food: { entries: [], count: 0, route: '/food' },
  items: [
    {
      id: `next:${id}`,
      sourceId: id,
      sourceRevision: 1,
      kind: 'next',
      task,
      step: null,
      waitingReason: null,
      route: { kind: 'task', id },
      dedupeKey: `next:${id}:next`,
    },
  ],
};
const preferences = { enabled: true, due: true, handoff: true, failure: true };
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue({ granted: true } as Awaited<
      ReturnType<typeof Notifications.getPermissionsAsync>
    >);
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
  jest.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('owned-alert');
});
test('local due reconciliation keeps previews private and replaces changed/obsolete owned schedules', async () => {
  await reconcileDueNotifications({
    installation: 'https://fictional.example.test',
    attention,
    preferences,
    authenticated: true,
  });
  const input = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]?.[0];
  expect(JSON.stringify(input)).not.toContain(task.content.title);
  expect(input?.content.data?.route).toEqual({ kind: 'task', id });
  expect(input?.trigger).toEqual({ type: 'date', date: new Date(task.schedule.dueAt!) });
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
    {
      identifier: 'obsolete',
      content: {
        data: {
          memsAttentionInstallation: 'https://fictional.example.test',
          signature: 'old-deadline',
        },
      },
    },
    {
      identifier: 'foreign',
      content: { data: { memsAttentionInstallation: 'https://other.example.test' } },
    },
  ] as Awaited<ReturnType<typeof Notifications.getAllScheduledNotificationsAsync>>);
  await reconcileDueNotifications({
    installation: 'https://fictional.example.test',
    attention: null,
    preferences,
    authenticated: false,
  });
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('obsolete');
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('foreign');
});
test('denied OS permission preserves Today; opt-out never registers push token', async () => {
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue({ granted: false } as Awaited<
      ReturnType<typeof Notifications.getPermissionsAsync>
    >);
  expect(
    await reconcileDueNotifications({
      installation: 'https://fictional.example.test',
      attention,
      preferences,
      authenticated: true,
    }),
  ).toContain('not allowed');
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  const api = { register: jest.fn(), deactivate: jest.fn() };
  await registerRemoteNotifications({
    installation: 'https://fictional.example.test',
    preferences: { revision: 1, value: { ...preferences, enabled: false } },
    api,
    providerConfigured: true,
    projectId: 'configured-project',
  });
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(api.register).not.toHaveBeenCalled();
});
test('current preference revision and installation-scoped identity register only with configured project', async () => {
  jest
    .mocked(Notifications.getExpoPushTokenAsync)
    .mockResolvedValue({ data: 'ExpoPushToken[fixture]', type: 'expo' });
  const api = { register: jest.fn(), deactivate: jest.fn() };
  await registerRemoteNotifications({
    installation: 'https://fictional.example.test',
    preferences: { revision: 3, value: preferences },
    api,
    providerConfigured: true,
    projectId: 'configured-project',
  });
  expect(api.register).toHaveBeenCalledWith({
    deviceId: '11111111-1111-4111-8111-111111111111',
    token: 'ExpoPushToken[fixture]',
    expectedPreferenceRevision: 3,
  });
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
    projectId: 'configured-project',
  });
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('11111111-1111-4111-8111-111111111111');
  await clearNotificationsOnLogout('https://fictional.example.test', api);
  expect(api.deactivate).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
});
test('response rejects arbitrary URLs and requires current owner record existence', async () => {
  expect(notificationResponseRoute({ route: { kind: 'task', id } })).toEqual({ kind: 'task', id });
  expect(notificationResponseRoute({ route: { kind: 'task', id: 'https://bad.test' } })).toBeNull();
  expect(
    notificationResponseRoute({ route: { kind: 'task', id, url: 'https://bad.test' } }),
  ).toBeNull();
  expect(
    await resolveNotificationResponse({ route: { kind: 'task', id } }, async () => false),
  ).toBeNull();
  expect(
    await resolveNotificationResponse({ route: { kind: 'task', id } }, async () => true),
  ).toEqual({ kind: 'task', id });
});
