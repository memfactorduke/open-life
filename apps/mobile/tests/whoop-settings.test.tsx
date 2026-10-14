import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Whoop } from '../src/features/Whoop';
import type { InstallationClient } from '../src/client';
jest.mock('../src/client', () => ({ RequestRejectedError: class extends Error {} }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
const state = {
  configured: false,
  revision: 0,
  status: 'unconfigured',
  accountId: null,
  providerAccountId: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  error: null,
  stale: false,
  nextRefreshAt: null,
  observations: [],
};
test('WHOOP setup shows actual availability with saved observations disclosed', async () => {
  const request = jest.fn(async (path: string) =>
    path.startsWith('/api/sessions') ? { sessions: [], nextCursor: null } : state,
  );
  await render(<Whoop client={{ request } as unknown as InstallationClient} />);
  await waitFor(() =>
    expect(
      screen.getByText('WHOOP cannot connect until it is set up for this installation.'),
    ).toBeOnTheScreen(),
  );
  expect(screen.getByText('Not set up')).toBeOnTheScreen();
  expect(screen.queryByText(/stale/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Connect WHOOP' })).toBeNull();
  expect(screen.queryByText(/Initial context covers/)).toBeNull();
  expect(screen.getByRole('button', { name: 'View saved observations (0)' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'View saved observations (0)' }));
  expect(screen.getByRole('button', { name: 'Hide saved observations' })).toBeOnTheScreen();
});
test('a disconnected configured WHOOP connection offers consent without claiming connection', async () => {
  const request = jest.fn(async (path: string) =>
    path.startsWith('/api/sessions')
      ? { sessions: [], nextCursor: null }
      : { ...state, configured: true, status: 'disconnected' },
  );
  await render(<Whoop client={{ request } as unknown as InstallationClient} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Connect WHOOP' })).toBeOnTheScreen(),
  );
  expect(screen.getByText('Not connected')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Disconnect WHOOP' })).toBeNull();
  expect(request.mock.calls.some((call) => call[0].includes('commands'))).toBe(false);
});
