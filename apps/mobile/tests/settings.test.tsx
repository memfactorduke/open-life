import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Settings } from '../src/App';
import type { InstallationClient } from '../src/client';

jest.mock('../src/client', () => ({
  createInstallationClient: jest.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('expo-secure-store', () => ({}));
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
      onSaved={jest.fn()}
      onExpired={jest.fn()}
      onSignedOut={jest.fn()}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'Jordan');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(alert).toHaveBeenCalledWith(
    'Discard unsaved preferences?',
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ text: 'Discard and sign out', style: 'destructive' }),
    ]),
  );
  expect(signOut).not.toHaveBeenCalled();
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
