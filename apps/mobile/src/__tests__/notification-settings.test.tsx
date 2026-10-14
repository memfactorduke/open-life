import React from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NotificationSettings } from '../features/NotificationSettings';
import * as Notifications from 'expo-notifications';
import { registerRemoteNotifications } from '../notifications';
import { RequestRejectedError, type InstallationClient } from '../client';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn() }));
jest.mock('../notifications', () => ({ registerRemoteNotifications: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));
const off = { enabled: false, due: false, handoff: false, failure: false };
beforeEach(() => jest.clearAllMocks());
test('opening Settings never requests permission; explicit device enable uses saved choices', async () => {
  const request = jest.fn(async (_path, body?) =>
    body
      ? { revision: 2, value: body.value }
      : { revision: 1, value: off, providerConfigured: false },
  );
  const client = { baseURL: 'https://fictional.example', request } as unknown as InstallationClient;
  await render(<NotificationSettings client={client} />);
  await waitFor(() => expect(screen.getByLabelText('Enable notifications')).toBeTruthy());
  expect(registerRemoteNotifications).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Due reminders')).toBeNull();
  jest
    .mocked(registerRemoteNotifications)
    .mockResolvedValue('Notifications are not allowed. Attention remains available in Today.');
  await fireEvent(screen.getByLabelText('Enable notifications'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Save notification choices'));
  await waitFor(() => expect(screen.getByText(/Notifications are not allowed/)).toBeTruthy());
  expect(registerRemoteNotifications).toHaveBeenCalledWith(
    expect.objectContaining({ preferences: { revision: 2, value: { ...off, enabled: true } } }),
  );
});
test('revision conflict retains draft and retry uses refreshed revision', async () => {
  let reads = 0;
  let writes = 0;
  const request = jest.fn(async (_path, body?) => {
    if (!body) return { revision: ++reads === 1 ? 1 : 3, value: off, providerConfigured: false };
    if (++writes === 1) throw new RequestRejectedError(409, 'Changed elsewhere');
    return { revision: 4, value: body.value };
  });
  await render(
    <NotificationSettings
      client={{ baseURL: 'fictional', request } as unknown as InstallationClient}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Enable notifications')).toBeTruthy());
  await fireEvent(screen.getByLabelText('Enable notifications'), 'valueChange', true);
  await fireEvent(screen.getByLabelText('Due reminders'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Save notification choices'));
  await waitFor(() => expect(screen.getByText(/These choices changed elsewhere/)).toBeTruthy());
  expect(screen.getByLabelText('Due reminders').props.value).toBe(true);
  jest.mocked(registerRemoteNotifications).mockResolvedValue('Notification choices saved.');
  await fireEvent.press(screen.getByLabelText('Save reviewed notification choices'));
  await waitFor(() => expect(screen.getByText('Notification choices saved.')).toBeTruthy());
  expect(request).toHaveBeenLastCalledWith(
    '/api/notifications/preferences',
    expect.objectContaining({ expectedRevision: 3, value: { ...off, enabled: true, due: true } }),
  );
});

test('unconfirmed notification save retries the immutable request before device permission', async () => {
  let writes = 0;
  const request = jest.fn(async (_path, body?) => {
    if (!body) return { revision: 1, value: off, providerConfigured: false };
    if (++writes === 1) throw new Error('Connection interrupted');
    return { revision: 2, value: body.value };
  });
  await render(
    <NotificationSettings
      client={{ baseURL: 'fictional', request } as unknown as InstallationClient}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Enable notifications')).toBeTruthy());
  await fireEvent(screen.getByLabelText('Enable notifications'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Save notification choices'));
  await waitFor(() => expect(screen.getByText(/The save is unconfirmed/)).toBeTruthy());
  expect(registerRemoteNotifications).not.toHaveBeenCalled();
  const first = request.mock.calls.find((call) => call[1])![1];
  await fireEvent.press(screen.getByLabelText('Retry notification settings'));
  await waitFor(() => expect(registerRemoteNotifications).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.filter((call) => call[1]).map((call) => call[1])).toEqual([
    first,
    first,
  ]);
});

test('denied notification permission offers OS Settings only after an explicit action', async () => {
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  jest
    .mocked(registerRemoteNotifications)
    .mockResolvedValue('Notifications are not allowed. Attention remains available in Today.');
  const request = jest.fn(async (_path, body?) =>
    body
      ? { revision: 2, value: body.value }
      : { revision: 1, value: off, providerConfigured: false },
  );
  await render(
    <NotificationSettings
      client={{ baseURL: 'fictional', request } as unknown as InstallationClient}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Enable notifications')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Open notification settings' })).toBeNull();
  await fireEvent(screen.getByLabelText('Enable notifications'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Save notification choices'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Open notification settings' })).toBeOnTheScreen(),
  );
  expect(settings).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Open notification settings' }));
  expect(settings).toHaveBeenCalledTimes(1);
  settings.mockRestore();
});

test('returning from OS Settings rechecks denial without discarding unsaved notification choices', async () => {
  let foreground: (state: AppStateStatus) => void = () => {};
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      foreground = listener;
      return { remove: jest.fn() };
    });
  const permission = jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue({ granted: true } as never);
  jest
    .mocked(registerRemoteNotifications)
    .mockResolvedValue('Notifications are not allowed. Attention remains available in Today.');
  const request = jest.fn(async (_path, body?) =>
    body
      ? { revision: 2, value: body.value }
      : { revision: 1, value: off, providerConfigured: false },
  );
  await render(
    <NotificationSettings
      client={{ baseURL: 'fictional', request } as unknown as InstallationClient}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Enable notifications')).toBeTruthy());
  await fireEvent(screen.getByLabelText('Enable notifications'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Save notification choices'));
  await screen.findByRole('button', { name: 'Open notification settings' });
  await fireEvent(screen.getByLabelText('Due reminders'), 'valueChange', true);
  await foreground('active');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Open notification settings' })).toBeNull(),
  );
  expect(screen.getByLabelText('Due reminders').props.value).toBe(true);
  expect(request.mock.calls.filter((call) => call[1])).toHaveLength(1);
  permission.mockReset();
  subscription.mockRestore();
});
