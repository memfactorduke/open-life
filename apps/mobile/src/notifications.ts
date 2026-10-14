import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import {
  notificationRoute,
  type AttentionResponse,
  type AttentionRoute,
  type NotificationPreferences,
} from '@mems-life/domain';
import { installationStoragePrefix } from './installation';
const key = (installation: string, suffix: string) =>
  `${installationStoragePrefix(installation)}-attention-${suffix}`;
export async function notificationDeviceIdentity(installation: string) {
  const name = key(installation, 'device');
  let id = await SecureStore.getItemAsync(name);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(name, id);
  }
  return id;
}
export type NotificationApi = {
  register: (input: {
    deviceId: string;
    token: string;
    expectedPreferenceRevision: number;
  }) => Promise<unknown>;
  deactivate: (deviceId: string) => Promise<unknown>;
};
/** Invoke only after the owner explicitly enables alerts. Project identity is deployment configuration. */
export async function registerRemoteNotifications(input: {
  installation: string;
  projectId?: string;
  providerConfigured: boolean;
  preferences: { revision: number; value: NotificationPreferences };
  api: NotificationApi;
}): Promise<string> {
  if (!input.preferences.value.enabled) return 'Notifications are disabled.';
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain !== false)
    permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    return 'Notifications are not allowed. Attention remains available in Today.';
  const projectId =
    input.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!input.providerConfigured)
    return 'Remote alerts are not configured. In-app attention and local reminders remain available.';
  if (!projectId)
    return 'This native build has no push project configured. In-app attention and local reminders remain available.';
  try {
    const deviceId = await notificationDeviceIdentity(input.installation);
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await input.api.register({
      deviceId,
      token,
      expectedPreferenceRevision: input.preferences.revision,
    });
    return '';
  } catch {
    return 'Remote alerts could not be registered. Retry from notification settings.';
  }
}
let queue: Promise<unknown> = Promise.resolve();
/** Serialized reconciliation owns only this installation's due alerts; recover orphan schedules on restart. */
export function reconcileDueNotifications(input: {
  installation: string;
  attention: AttentionResponse | null;
  preferences: NotificationPreferences;
  authenticated: boolean;
}): Promise<string> {
  const result = queue.then(() => reconcileDue(input));
  queue = result.catch(() => undefined);
  return result;
}
async function reconcileDue({
  installation,
  attention,
  preferences,
  authenticated,
}: {
  installation: string;
  attention: AttentionResponse | null;
  preferences: NotificationPreferences;
  authenticated: boolean;
}): Promise<string> {
  const eligible = authenticated && preferences.enabled && preferences.due && attention;
  const wanted = new Map<string, { route: AttentionRoute; at: string }>();
  if (eligible && attention)
    for (const item of attention.items) {
      if (
        ['next', 'handoff', 'due'].includes(item.kind) &&
        !item.waitingReason &&
        !item.task.paused &&
        item.task.phase !== 'planned' &&
        item.task.phase !== 'completed' &&
        !item.task.archivedAt &&
        !item.task.deletedAt &&
        !item.task.schedule.skippedAt &&
        item.task.schedule.dueAt &&
        Date.parse(item.task.schedule.dueAt) > Math.max(Date.now(), Date.parse(attention.now))
      ) {
        if (wanted.size >= 50) break;
        wanted.set(`${item.task.id}:${item.task.schedule.dueAt}`, {
          route: item.route,
          at: item.task.schedule.dueAt,
        });
      }
    }
  const name = key(installation, 'scheduled');
  let stored: Record<string, string> = {};
  try {
    const parsed = JSON.parse((await SecureStore.getItemAsync(name)) ?? '{}');
    stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    /* Repair metadata. */
  }
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const retained = new Map<string, string>();
  for (const notification of pending) {
    if (notification.content.data?.memsAttentionInstallation !== installation) continue;
    const signature = notification.content.data.signature;
    if (typeof signature === 'string' && wanted.has(signature) && !retained.has(signature)) {
      retained.set(signature, notification.identifier);
    } else await Notifications.cancelScheduledNotificationAsync(notification.identifier);
  }
  for (const [signature, id] of Object.entries(stored))
    if (!retained.has(signature)) await Notifications.cancelScheduledNotificationAsync(id);
  if (!wanted.size) {
    await SecureStore.deleteItemAsync(name);
    return '';
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    for (const id of retained.values()) await Notifications.cancelScheduledNotificationAsync(id);
    await SecureStore.deleteItemAsync(name);
    return 'Notifications are not allowed. Due work remains in Today.';
  }
  for (const [signature, event] of wanted)
    if (!retained.has(signature)) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Mem’s Life',
          body: 'An item needs your attention. Open the app to review it.',
          data: { memsAttentionInstallation: installation, signature, route: event.route },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(event.at),
        },
      });
      retained.set(signature, id);
    }
  await SecureStore.setItemAsync(name, JSON.stringify(Object.fromEntries(retained)));
  return '';
}
export function notificationResponseRoute(data: unknown): AttentionRoute | null {
  if (!data || typeof data !== 'object') return null;
  return notificationRoute((data as { route?: unknown }).route);
}
/** Validate record existence with the owner API before opening a route. */
export async function resolveNotificationResponse(
  data: unknown,
  exists: (route: AttentionRoute) => Promise<boolean>,
): Promise<AttentionRoute | null> {
  const route = notificationResponseRoute(data);
  return route && (await exists(route)) ? route : null;
}
export async function clearNotificationsOnLogout(installation: string, api?: NotificationApi) {
  const id = await SecureStore.getItemAsync(key(installation, 'device'));
  if (id && api)
    try {
      await api.deactivate(id);
    } catch {
      /* Session invalidation also retires server registrations. */
    }
  await reconcileDueNotifications({
    installation,
    attention: null,
    authenticated: false,
    preferences: { enabled: false, due: false, handoff: false, failure: false },
  });
}
