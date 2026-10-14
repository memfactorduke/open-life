import React from 'react';
import { Alert, Share } from 'react-native';
import { exportRecoveryShareFile } from '../src/offline/photo-export';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import { Settings } from '../src/App';
import type { InstallationClient } from '../src/client';

jest.mock('../src/client', () => ({
  createInstallationClient: jest.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('expo-secure-store', () => ({ deleteItemAsync: jest.fn() }));
jest.mock('../src/offline/photo-export', () => ({ exportRecoveryShareFile: jest.fn() }));
jest.mock('../src/notifications', () => ({
  clearNotificationsOnLogout: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/timers', () => ({ reconcileTimerAlert: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/features/NotificationSettings', () => ({ NotificationSettings: () => null }));
jest.mock('../src/features/AgentAccess', () => ({ AgentAccess: () => null }));

const value = {
  displayName: 'Morgan',
  timeZone: 'UTC',
  weightUnit: 'kg' as const,
  distanceUnit: 'km' as const,
  theme: 'system' as const,
};
const session = {
  me: {
    user: { id: 'owner-1', name: 'Morgan', email: 'morgan@example.com' },
    installationId: 'installation-1',
  },
  preferences: { revision: 0, value },
};

test('saved preferences must be reviewed before local edits can be resubmitted', async () => {
  const request = jest
    .fn()
    .mockResolvedValue({ revision: 2, value: { ...value, displayName: 'Taylor' } });
  const saved = jest.fn();
  const client = {
    request,
    baseURL: 'https://life.example.com',
    auth: {},
  } as unknown as InstallationClient;
  await render(
    <Settings
      client={client}
      session={session}
      initialSection="Profile"
      onSaved={saved}
      onExpired={jest.fn()}
      onSignedOut={jest.fn()}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'Jordan');
  await fireEvent.press(screen.getByRole('button', { name: 'Check saved preferences' }));
  await waitFor(() => expect(screen.getByText('Review saved preferences')).toBeOnTheScreen());
  expect(screen.getByLabelText('Display name').props.value).toBe('Jordan');
  expect(
    screen.getByRole('button', { name: 'Save preferences' }).props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Use saved preferences' }));
  expect(screen.getByLabelText('Display name').props.value).toBe('Taylor');
  expect(saved).toHaveBeenCalledWith({ revision: 2, value: { ...value, displayName: 'Taylor' } });
});

test('signing out with unsaved edits requires an explicit discard', async () => {
  const signOut = jest.fn().mockResolvedValue({ error: null });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const client = {
    request: jest.fn(),
    baseURL: 'https://life.example.com',
    auth: { signOut },
  } as unknown as InstallationClient;
  await render(
    <Settings
      client={client}
      session={session}
      initialSection="Profile"
      onSaved={jest.fn()}
      onExpired={jest.fn()}
      onSignedOut={jest.fn()}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'Jordan');
  await fireEvent.press(screen.getByRole('button', { name: 'Back to settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Account' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(alert).toHaveBeenCalledWith(
    'Discard unsaved preferences?',
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ text: 'Discard and sign out', style: 'destructive' }),
    ]),
  );
  expect(signOut).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Profile' }));
  expect(screen.getByLabelText('Display name').props.value).toBe('Jordan');
  alert.mockRestore();
});

test('reviewed edits save against the inspected server state without replacing the draft', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 2, value: { ...value, displayName: 'Taylor' } })
    .mockResolvedValueOnce({ revision: 3, value: { ...value, displayName: 'Jordan' } });
  const client = {
    request,
    baseURL: 'https://life.example.com',
    auth: {},
  } as unknown as InstallationClient;
  await render(
    <Settings
      client={client}
      session={session}
      initialSection="Profile"
      draft={{ ...value, displayName: 'Jordan' }}
      onSaved={jest.fn()}
      onExpired={jest.fn()}
      onSignedOut={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Display name').props.value).toBe('Jordan');
  await fireEvent.press(screen.getByRole('button', { name: 'Check saved preferences' }));
  await waitFor(() => expect(screen.getByText('Review saved preferences')).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: 'Keep my reviewed edits' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save preferences' }));
  await waitFor(() =>
    expect(screen.getByText('Preferences saved to your installation.')).toBeOnTheScreen(),
  );
  expect(request).toHaveBeenLastCalledWith('/api/preferences', {
    operationId: '00000000-0000-4000-8000-000000000001',
    expectedRevision: 2,
    value: {
      displayName: 'Jordan',
      timeZone: 'UTC',
      weightUnit: 'kg',
      distanceUnit: 'km',
      theme: 'system',
    },
  });
});

function logoutClient(photos: Array<{ status: string; delivery?: string }>) {
  return {
    request: jest.fn(),
    baseURL: 'https://life.example.com',
    auth: { signOut: jest.fn().mockResolvedValue({ error: null }) },
    offline: {
      store: {
        outbox: jest.fn().mockResolvedValue([]),
        photos: jest.fn().mockResolvedValue(photos),
        signIn: jest.fn().mockResolvedValue(undefined),
      },
      signOut: jest.fn().mockResolvedValue(undefined),
      notify: jest.fn(),
    },
  };
}
async function renderLogout(client: ReturnType<typeof logoutClient>) {
  const signedOut = jest.fn();
  await render(
    <Settings
      client={client as unknown as InstallationClient}
      session={session}
      initialSection="Account"
      onSaved={jest.fn()}
      onExpired={jest.fn()}
      onSignedOut={signedOut}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  return signedOut;
}

const photoStates = [
  { status: 'pending', delivery: 'never-sent' },
  { status: 'pending', delivery: 'uncertain' },
  { status: 'needs-attention', delivery: 'review' },
];
test.each(photoStates)('photo-only logout asks for a choice: %j', async (photo) => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const client = logoutClient([photo]);
  try {
    await renderLogout(client);
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'Saved changes are waiting to synchronize',
        expect.any(String),
        expect.arrayContaining(
          [
            'Keep editing',
            'Retain and sign out',
            'Discard and sign out',
            'Export and sign out',
          ].map((text) => expect.objectContaining({ text })),
        ),
      ),
    );
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(client.offline.signOut).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});

test('synced and discarded photos allow ordinary logout', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const client = logoutClient([{ status: 'synced' }, { status: 'discarded' }]);
  try {
    const signedOut = await renderLogout(client);
    await waitFor(() => expect(signedOut).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect(client.offline.signOut).toHaveBeenCalledWith('retain');
  } finally {
    alert.mockRestore();
  }
});

test.each(['shared', 'dismissed', 'export failure', 'share failure'])(
  'recovery export logout: %s',
  async (outcome) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const share = jest.spyOn(Share, 'share');
    const exporter = jest.mocked(exportRecoveryShareFile);
    exporter.mockReset();
    if (outcome === 'export failure')
      exporter.mockRejectedValue(new Error('Image checksum failed'));
    else exporter.mockResolvedValue('file:///documents/recovery/recovery.json');
    if (outcome === 'share failure') share.mockRejectedValue(new Error('Sharing failed'));
    else
      share.mockResolvedValue({
        action: outcome === 'dismissed' ? Share.dismissedAction : Share.sharedAction,
      });
    const client = logoutClient([{ status: 'needs-attention' }]);
    // An unrelated pending edit also reproduces the old export path while photo-only cases verify the guard.
    client.offline.store.outbox.mockResolvedValue([{ state: 'review' }] as never);
    try {
      const signedOut = await renderLogout(client);
      await waitFor(() => expect(alert).toHaveBeenCalled());
      const buttons = alert.mock.calls.at(-1)?.[2];
      const exportChoice = buttons?.find((button) => button.text === 'Export and sign out');
      expect(exportChoice).toBeDefined();
      await act(async () => {
        exportChoice?.onPress?.();
      });
      await waitFor(() => expect(exporter).toHaveBeenCalledWith(client.offline.store));
      if (outcome === 'shared') {
        await waitFor(() => expect(signedOut).toHaveBeenCalled());
        expect(share).toHaveBeenCalledWith({
          url: 'file:///documents/recovery/recovery.json',
          title: 'Mem’s Life saved local changes',
        });
        expect(client.offline.signOut).toHaveBeenCalledWith('retain');
      } else {
        if (outcome.includes('failure'))
          await waitFor(() =>
            expect(
              screen.getByText(
                outcome === 'export failure' ? 'Image checksum failed' : 'Sharing failed',
              ),
            ).toBeOnTheScreen(),
          );
        else await waitFor(() => expect(share).toHaveBeenCalled());
        expect(client.auth.signOut).not.toHaveBeenCalled();
        expect(client.offline.signOut).not.toHaveBeenCalled();
        expect(signedOut).not.toHaveBeenCalled();
      }
    } finally {
      alert.mockRestore();
      share.mockRestore();
    }
  },
);
