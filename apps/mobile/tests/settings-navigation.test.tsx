import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { defaultPreferences } from '@mems-life/domain';
import { Settings } from '../src/App';
import type { InstallationClient } from '../src/client';
import { registerRemoteNotifications } from '../src/notifications';

jest.mock('../src/client', () => ({
  createInstallationClient: jest.fn(),
  SessionExpiredError: class extends Error {},
  RequestRejectedError: class extends Error {},
}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));
jest.mock('../src/SyncStatus', () => ({ SyncStatus: () => null }));
jest.mock('../src/features/AgentAccess', () => ({ AgentAccess: () => null }));
jest.mock('../src/features/Whoop', () => ({ Whoop: () => null }));
jest.mock('../src/offline/photo-export', () => ({}));
jest.mock('../src/notifications', () => ({
  registerRemoteNotifications: jest.fn(),
  clearNotificationsOnLogout: jest.fn(),
}));
const session = {
  me: {
    user: { id: 'fictional', name: 'Fictional', email: 'fictional@example.test' },
    installationId: 'fixture',
  },
  preferences: { revision: 1, value: defaultPreferences() },
};
const off = { enabled: false, due: false, handoff: false, failure: false };

test('Settings navigation preserves a notification draft and the exact unconfirmed retry', async () => {
  let writes = 0;
  const request = jest.fn(async (_path, command?) => {
    if (!command) return { revision: 1, value: off, providerConfigured: false };
    if (++writes === 1) throw new Error('Response interrupted');
    return { revision: 2, value: command.value };
  });
  jest.mocked(registerRemoteNotifications).mockResolvedValue('Notification choices saved.');
  await render(
    <Settings
      client={{ baseURL: 'https://fictional.example', request } as unknown as InstallationClient}
      session={session}
      onSaved={jest.fn()}
      onSignedOut={jest.fn()}
      onExpired={jest.fn()}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Notifications' }));
  await waitFor(() => expect(screen.getByLabelText('Enable notifications')).toBeTruthy());
  await fireEvent(screen.getByLabelText('Enable notifications'), 'valueChange', true);
  await fireEvent(screen.getByLabelText('Due reminders'), 'valueChange', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Back to settings' }));
  expect(screen.queryByLabelText('Due reminders')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Notifications' }));
  expect(screen.getByLabelText('Due reminders').props.value).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Save notification choices' }));
  await waitFor(() => expect(screen.getByText(/The save is unconfirmed/)).toBeTruthy());
  const original = request.mock.calls.find((call) => call[1])![1];
  await fireEvent.press(screen.getByRole('button', { name: 'Back to settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Profile' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Back to settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Notifications' }));
  expect(request.mock.calls.filter((call) => !call[1])).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry notification settings' }));
  await waitFor(() => expect(registerRemoteNotifications).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.filter((call) => call[1]).map((call) => call[1])).toEqual([
    original,
    original,
  ]);
});
