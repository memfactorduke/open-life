import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import type { SessionTimer, WorkoutSession } from '@mems-life/domain';
import { installationStoragePrefix } from './installation';
const key = (installation: string, suffix: string) =>
  `${installationStoragePrefix(installation)}-timer-${suffix}`;
export async function deviceIdentity(installation: string): Promise<string> {
  const name = key(installation, 'device');
  const saved = await SecureStore.getItemAsync(name);
  if (saved) return saved;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(name, id);
  return id;
}
export type TimerPreferences = { alerts: boolean; sound: boolean; haptics: boolean };
export async function readTimerPreferences(installation: string): Promise<TimerPreferences> {
  try {
    const raw = await SecureStore.getItemAsync(key(installation, 'preferences'));
    const value = raw ? JSON.parse(raw) : {};
    return {
      alerts: value.alerts === true,
      sound: value.sound === true,
      haptics: value.haptics === true,
    };
  } catch {
    return { alerts: false, sound: false, haptics: false };
  }
}
export async function saveTimerPreferences(installation: string, preferences: TimerPreferences) {
  await SecureStore.setItemAsync(key(installation, 'preferences'), JSON.stringify(preferences));
}
export async function timerHaptic() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
type AlertInput = {
  installation: string;
  session: WorkoutSession | null;
  timer: SessionTimer | null;
  deviceId: string;
  enabled: boolean;
  sound: boolean;
  haptics: boolean;
  serverNow: number;
};
let queue: Promise<unknown> = Promise.resolve();
/** Reconcile this installation's single owned alert, including on restart; never cancel another app's alerts. */
export function reconcileTimerAlert(input: AlertInput): Promise<string> {
  const result = queue.then(() => reconcile(input));
  queue = result.catch(() => undefined);
  return result;
}
async function reconcile({
  installation,
  session,
  timer,
  deviceId,
  enabled,
  sound,
  serverNow,
}: AlertInput): Promise<string> {
  const name = key(installation, 'notification');
  const prior = await SecureStore.getItemAsync(name);
  const seconds = timer?.deadline ? Math.ceil((Date.parse(timer.deadline) - serverNow) / 1000) : 0;
  const eligible =
    enabled &&
    session?.status === 'active' &&
    timer?.state === 'running' &&
    timer.initiatingDeviceId === deviceId &&
    seconds > 0;
  const signature = eligible ? `${timer.id}:${timer.deadline}:${sound}` : null;
  let stored: { id: string; signature: string } | null = null;
  try {
    stored = prior ? JSON.parse(prior) : null;
  } catch {
    /* Repair invalid local metadata. */
  }
  if (stored?.signature === signature) {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    if (pending.some((n) => n.identifier === stored!.id)) return '';
  }
  if (stored) {
    await Notifications.cancelScheduledNotificationAsync(stored.id);
    await SecureStore.deleteItemAsync(name);
  }
  // Recover a notification whose schedule succeeded just before a process interruption.
  for (const notification of await Notifications.getAllScheduledNotificationsAsync())
    if (notification.content.data?.memsTimerInstallation === installation)
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
  if (!eligible)
    return timer && timer.initiatingDeviceId !== deviceId
      ? 'This timer’s initiating device owns its alert.'
      : '';
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted)
    return 'Notifications are not allowed. The saved timer still works in the app.';
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Mem’s Life',
      body: 'A timer has finished. Open the app to review it.',
      sound: sound ? 'default' : false,
      data: {
        memsTimerInstallation: installation,
        sessionId: session!.id,
        timerId: timer!.id,
        route: { kind: 'session', id: session!.id },
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, seconds),
      repeats: false,
    },
  });
  await SecureStore.setItemAsync(name, JSON.stringify({ id, signature }));
  return '';
}

/** Call only from an explicit owner enable action, never startup or foreground reconciliation. */
export async function requestTimerAlertPermission(): Promise<string> {
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  return permission.granted
    ? ''
    : 'Notifications are not allowed. The saved timer still works in the app.';
}
