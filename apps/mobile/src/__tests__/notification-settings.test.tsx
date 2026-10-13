import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NotificationSettings } from '../features/NotificationSettings';
import { registerRemoteNotifications } from '../notifications';
import { RequestRejectedError, type InstallationClient } from '../client';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
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
  await fireEvent(screen.getByLabelText('Enable notifications'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Save notification choices'));
  await waitFor(() => expect(screen.getByText('Notification choices saved.')).toBeTruthy());
  expect(registerRemoteNotifications).not.toHaveBeenCalled();
  jest
    .mocked(registerRemoteNotifications)
    .mockResolvedValue('Notifications are not allowed. Attention remains available in Today.');
  await fireEvent.press(screen.getByLabelText('Enable alerts on this device'));
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
  await waitFor(() => expect(screen.getByLabelText('Due reminders')).toBeTruthy());
  await fireEvent(screen.getByLabelText('Due reminders'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Save notification choices'));
  await waitFor(() => expect(screen.getByText(/These choices changed elsewhere/)).toBeTruthy());
  expect(screen.getByLabelText('Due reminders').props.value).toBe(true);
  await fireEvent.press(screen.getByLabelText('Save reviewed notification choices'));
  await waitFor(() => expect(screen.getByText('Notification choices saved.')).toBeTruthy());
  expect(request).toHaveBeenLastCalledWith(
    '/api/notifications/preferences',
    expect.objectContaining({ expectedRevision: 3, value: { ...off, due: true } }),
  );
});
