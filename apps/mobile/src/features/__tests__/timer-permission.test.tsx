import React from 'react';
import { Linking } from 'react-native';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { defaultPreferences } from '@mems-life/domain';
import { Sessions } from '../Sessions';
import type { InstallationClient } from '../../client';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('../../offline/expo', () => ({ openOfflineStore: jest.fn() }));
jest.mock('../../media', () => ({ uploadFoodPhoto: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) =>
    key.endsWith('preferences')
      ? JSON.stringify({ alerts: true, sound: false, haptics: false })
      : key.endsWith('device')
        ? 'fictional-device'
        : null,
  ),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(timerState = 'paused', sessionStatus = 'active') {
  const session = {
    id: id(1),
    revision: 1,
    name: 'Fictional offline workout',
    notes: '',
    status: sessionStatus,
    sourceRoutineId: null,
    sourceRoutineRevision: null,
    items: [],
    supersets: [],
    startedAt: '2026-10-13T12:00:00Z',
    updatedAt: '2026-10-13T12:00:00Z',
    finishedAt: sessionStatus === 'active' ? null : '2026-10-13T12:02:00Z',
    timer: {
      id: id(2),
      kind: 'rest',
      state: timerState,
      durationSeconds: 90,
      remainingSeconds: 60,
      deadline: timerState === 'running' ? '2026-10-15T12:00:00Z' : null,
      initiatingDeviceId: 'fictional-device',
      itemId: null,
      updatedAt: '2026-10-13T12:00:00Z',
      clockBasis: 'server',
    },
  };
  if (sessionStatus !== 'active') session.timer = null as never;
  const request = jest.fn(async (path: string) => {
    if (path === '/api/sessions/clock') throw new Error('Offline');
    if (path === '/api/sessions') return { sessions: [session], nextCursor: null };
    if (path === '/api/exercises') return { exercises: [] };
    if (path === '/api/routines') return { routines: [] };
    if (path.includes('/performance')) return { performances: [], nextCursor: null };
    throw new Error(`Unconfigured fictional request ${path}`);
  });
  return {
    client: {
      baseURL: 'https://fictional-timer.example',
      request,
    } as unknown as InstallationClient,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: false } as never);
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
    {
      identifier: 'owned-stale',
      content: {
        data: {
          memsTimerInstallation: 'https://fictional-timer.example',
          sessionId: id(1),
          timerId: id(2),
        },
      },
    },
    {
      identifier: 'foreign-alert',
      content: { data: { memsTimerInstallation: 'https://different.example' } },
    },
  ] as never);
});
test.each(['active', 'completed', 'abandoned'])(
  'cold offline launch cancels obsolete paused or terminal %s timer without a server clock or permission prompt',
  async (status) => {
    await render(
      <Sessions client={fixture('paused', status).client} preferences={defaultPreferences()} />,
    );
    if (status === 'active') await screen.findByText('Fictional offline workout');
    else await screen.findByRole('button', { name: 'Start workout' });
    await waitFor(() =>
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('owned-stale'),
    );
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith(
      'foreign-alert',
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  },
);
test('denied explicit timer enable keeps the choice off and opens OS Settings only on tap', async () => {
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await render(<Sessions client={fixture().client} preferences={defaultPreferences()} />);
  await screen.findByText('Fictional offline workout');
  await fireEvent.press(screen.getByRole('button', { name: 'Alerts' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Enable alerts' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Open notification settings' })).toBeOnTheScreen(),
  );
  expect(screen.getByRole('radio', { name: 'Off' }).props.accessibilityState.checked).toBe(true);
  expect(settings).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Open notification settings' }));
  expect(settings).toHaveBeenCalledTimes(1);
  settings.mockRestore();
});

test('a cold offline running timer cannot create a schedule using an unverified clock', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
  await render(<Sessions client={fixture('running').client} preferences={defaultPreferences()} />);
  await screen.findByText('Fictional offline workout');
  await waitFor(() =>
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('owned-stale'),
  );
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('initial session loading cannot cancel an existing owned schedule', async () => {
  const { client } = fixture();
  const original = client.request;
  let release!: (value: unknown) => void;
  client.request = jest.fn(async (path, ...rest) =>
    path === '/api/sessions'
      ? await new Promise((resolve) => {
          release = resolve;
        })
      : original(path, ...rest),
  );
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await waitFor(() => expect(release).toBeDefined());
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  const result = await original('/api/sessions');
  release(result);
  await waitFor(() =>
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('owned-stale'),
  );
});
