import { buildTaskAttention, TaskSchema, type AttentionResponse } from '@mems-life/domain';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { reconcileTimerAlert, requestTimerAlertPermission } from '../timers';
import type { WorkoutSession, SessionTimer } from '@mems-life/domain';
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));
import {
  clearNotificationsOnLogout,
  reconcileDueNotifications,
  registerRemoteNotifications,
  resolveNotificationResponse,
} from '../notifications';
const store = new Map<string, string>();
let schedules: { identifier: string; content: { data: Record<string, unknown> } }[] = [];
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'fictional-project' } } } },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2098-01-01T12:00:00Z';
const future = '2099-01-01T12:00:00Z';
const prefs = { enabled: true, due: true, handoff: true, failure: true };
function task(n: number, dueAt: string | null, paused = false) {
  return TaskSchema.parse({
    id: id(n),
    revision: 1,
    phase: 'next',
    paused,
    content: { title: 'Fictional task', description: '', notes: '' },
    schedule: { dueAt },
    order: n,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
  });
}
function attention(): AttentionResponse {
  const tasks = [task(1, future), task(2, null), task(3, future, true), task(4, future)];
  const items = buildTaskAttention(tasks, [], [], [], now);
  const waiting = items.find((item) => item.task.id === id(4))!;
  waiting.kind = 'waiting';
  waiting.waitingReason = 'agent';
  return {
    now,
    timezone: 'UTC',
    date: '2098-01-01',
    items,
    activeSession: null,
    food: { entries: [], count: 0, route: '/food' },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  schedules = [];
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    store.set(key, value);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    store.delete(key);
  });
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: false } as never);
  jest
    .mocked(Notifications.getAllScheduledNotificationsAsync)
    .mockImplementation(async () => schedules as never);
  jest
    .mocked(Notifications.cancelScheduledNotificationAsync)
    .mockImplementation(async (identifier) => {
      schedules = schedules.filter((s) => s.identifier !== identifier);
    });
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (input) => {
    const identifier = `owned-${schedules.length}`;
    schedules.push({ identifier, content: input.content as never });
    return identifier;
  });
});
test('only eligible future due work schedules; repeats retain it and opt-out cancels only this installation', async () => {
  schedules.push({
    identifier: 'other',
    content: { data: { memsAttentionInstallation: 'other-installation' } },
  });
  const input = {
    installation: 'https://fictional.example',
    attention: attention(),
    preferences: prefs,
    authenticated: true,
  };
  await reconcileDueNotifications(input);
  await reconcileDueNotifications(input);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        data: expect.objectContaining({ signature: `${id(1)}:${future}` }),
      }),
    }),
  );
  await reconcileDueNotifications({ ...input, preferences: { ...prefs, enabled: false } });
  expect(schedules.map((s) => s.identifier)).toEqual(['other']);
});
test('changed deadlines replace old schedules and logout deactivates registration and cancels due', async () => {
  const input = {
    installation: 'https://fictional.example',
    attention: attention(),
    preferences: prefs,
    authenticated: true,
  };
  await reconcileDueNotifications(input);
  input.attention.items[0].task.schedule.dueAt = '2099-02-01T12:00:00Z';
  await reconcileDueNotifications(input);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  await registerRemoteNotifications({
    ...input,
    providerConfigured: true,
    preferences: { revision: 3, value: prefs },
    api: { register: async () => undefined, deactivate: async () => undefined },
  });
  const deactivate = jest.fn(async () => undefined);
  await clearNotificationsOnLogout(input.installation, {
    register: async () => undefined,
    deactivate,
  });
  expect(deactivate).toHaveBeenCalledWith(id(99));
  expect(schedules).toHaveLength(0);
});
test('denial leaves choices intact, never asks permission during reconciliation, and registers config project only on explicit enable', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
  await reconcileDueNotifications({
    installation: 'fictional',
    attention: attention(),
    preferences: prefs,
    authenticated: true,
  });
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  const register = jest.fn();
  expect(
    await registerRemoteNotifications({
      installation: 'fictional',
      providerConfigured: true,
      preferences: { revision: 1, value: prefs },
      api: { register, deactivate: async () => undefined },
    }),
  ).toContain('not allowed');
  expect(register).not.toHaveBeenCalled();
  expect(prefs.enabled).toBe(true);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest
    .mocked(Notifications.getExpoPushTokenAsync)
    .mockResolvedValue({ data: 'ExpoPushToken[fictional]' } as never);
  await registerRemoteNotifications({
    installation: 'fictional',
    providerConfigured: true,
    preferences: { revision: 1, value: prefs },
    api: { register, deactivate: async () => undefined },
  });
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
    projectId: 'fictional-project',
  });
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ expectedPreferenceRevision: 1 }));
});
test('only authorized opaque record routes resolve', async () => {
  const exists = jest.fn(async () => true);
  expect(
    await resolveNotificationResponse({ route: 'https://malicious.invalid' }, exists),
  ).toBeNull();
  expect(exists).not.toHaveBeenCalled();
  expect(
    await resolveNotificationResponse({ route: { kind: 'task', id: id(1) } }, async () => false),
  ).toBeNull();
  expect(await resolveNotificationResponse({ route: { kind: 'task', id: id(1) } }, exists)).toEqual(
    { kind: 'task', id: id(1) },
  );
});

test('timer recovery never prompts; only explicit enable asks permission and routes to the session privately', async () => {
  const installation = 'https://timer-fictional.example';
  const timer = {
    id: id(30),
    deadline: future,
    state: 'running',
    initiatingDeviceId: id(99),
  } as SessionTimer;
  const session = { id: id(31), status: 'active' } as WorkoutSession;
  const input = {
    installation,
    session,
    timer,
    deviceId: id(99),
    enabled: true,
    sound: false,
    haptics: false,
    serverNow: Date.parse(now),
  };
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
  expect(await reconcileTimerAlert(input)).toContain('not allowed');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await requestTimerAlertPermission();
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
  await reconcileTimerAlert(input);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        body: 'A timer has finished. Open the app to review it.',
        data: expect.objectContaining({ route: { kind: 'session', id: id(31) } }),
      }),
    }),
  );
  await reconcileTimerAlert({ ...input, enabled: false, timer: null, session: null });
  expect(schedules).toHaveLength(0);
});
