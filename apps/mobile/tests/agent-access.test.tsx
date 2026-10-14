import React from 'react';
import { AppState } from 'react-native';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import { AgentAccess } from '../src/features/AgentAccess';
import type { InstallationClient } from '../src/client';

jest.mock('../src/client', () => ({
  RequestRejectedError: class RequestRejectedError extends Error {
    status = 409;
  },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }), {
  virtual: true,
});
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());
const id = '00000000-0000-4000-8000-000000000002';
const grant = {
  id,
  label: 'Fictional planner',
  scopes: ['tasks:read'],
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-10-12T00:00:00.000Z',
  revokedAt: null,
};
const secret = `ml_${id}.${'a'.repeat(43)}`;
function setup(failIssue = false) {
  let issued = false,
    revoked = false;
  const request = jest.fn(async (path: string, body?: unknown, method?: string) => {
    if (path === '/api/agent-grants/revoke') {
      revoked = true;
      return { grant: { id, revokedAt: '2026-10-12T01:00:00.000Z' } };
    }
    if (body !== undefined && method === 'POST') {
      issued = true;
      if (failIssue) throw new Error('Connection lost');
      return {
        grant: { id, label: grant.label, scopes: grant.scopes, expiresAt: grant.expiresAt },
        secret,
      };
    }
    return {
      grants: issued ? [{ ...grant, revokedAt: revoked ? '2026-10-12T01:00:00.000Z' : null }] : [],
    };
  });
  const client = {
    request,
    baseURL: 'https://fictional.example',
    auth: {},
  } as unknown as InstallationClient;
  return { request, client };
}
async function create() {
  await waitFor(() =>
    expect(screen.getByText('No agent access has been issued.')).toBeOnTheScreen(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Add agent', exact: true }));
  await fireEvent.changeText(screen.getByLabelText('Agent name'), 'Fictional planner');
  await fireEvent.press(screen.getByRole('button', { name: 'Create one-time key' }));
}
test('issues scoped expiring access, clears one-time key, and revokes with retained metadata', async () => {
  const { client, request } = setup();
  await render(<AgentAccess client={client} />);
  await create();
  await waitFor(() => expect(screen.getByLabelText('One-time agent key')).toBeOnTheScreen());
  const body = request.mock.calls.find(
    (call) => call.length === 3 && call[0] === '/api/agent-grants',
  )?.[1] as { scopes: string[]; expiresAt: string };
  expect(body.scopes).toEqual(['tasks:read']);
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  expect(screen.getByLabelText('One-time agent key').props.selectable).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Done · hide key' }));
  expect(screen.queryByLabelText('One-time agent key')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Revoke Fictional planner' }));
  await waitFor(() => expect(screen.getByText(/history retained/)).toBeOnTheScreen());
  expect(screen.queryByRole('button', { name: 'Revoke Fictional planner' })).toBeNull();
});
test('lost issuance response is never automatically retried and requires grant review', async () => {
  const { client, request } = setup(true);
  await render(<AgentAccess client={client} />);
  await create();
  await waitFor(() => expect(screen.getByText(/The key could not be retrieved/)).toBeOnTheScreen());
  expect(screen.queryByLabelText('One-time agent key')).toBeNull();
  expect(
    request.mock.calls.filter((call) => call.length === 3 && call[0] === '/api/agent-grants'),
  ).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: 'Create one-time key' }).props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Revoke Fictional planner' }));
  await waitFor(() => expect(screen.getByText(/history retained/)).toBeOnTheScreen());
  await fireEvent.press(
    screen.getByRole('button', { name: 'I reviewed grants; create a replacement' }),
  );
  expect(
    screen.getByRole('button', { name: 'Create one-time key' }).props.accessibilityState.disabled,
  ).toBe(false);
});
test('backgrounding clears key and does not recover it on foreground', async () => {
  let listener: (state: string) => void = () => {};
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listener = callback;
    return { remove: jest.fn() };
  });
  const { client } = setup();
  await render(<AgentAccess client={client} />);
  await create();
  await waitFor(() => expect(screen.getByLabelText('One-time agent key')).toBeOnTheScreen());
  await act(() => listener('background'));
  await act(() => listener('active'));
  expect(screen.queryByLabelText('One-time agent key')).toBeNull();
  spy.mockRestore();
});
test('permission choices are independent and invalid expiry is rejected before issuance', async () => {
  const { client, request } = setup();
  await render(<AgentAccess client={client} />);
  await waitFor(() =>
    expect(screen.getByText('No agent access has been issued.')).toBeOnTheScreen(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Add agent', exact: true }));
  await fireEvent.changeText(screen.getByLabelText('Agent name'), 'Fictional planner');
  await fireEvent.press(screen.getByRole('radio', { name: 'Custom', exact: true }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Plan exercises and routines' }));
  expect(
    screen.getByRole('checkbox', { name: 'Plan exercises and routines' }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(
    screen.getByRole('checkbox', { name: 'Record reported or imported workouts' }).props
      .accessibilityState.checked,
  ).toBe(false);
  await fireEvent.press(screen.getByRole('radio', { name: 'Custom date' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose access ends' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Enter timestamp manually' }));
  await fireEvent.changeText(
    screen.getByLabelText('Access ends timestamp'),
    '2020-01-01T00:00:00.000Z',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Apply access ends' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Create one-time key' }));
  await waitFor(() =>
    expect(screen.getByText(/set an expiry within the next year/)).toBeOnTheScreen(),
  );
  expect(request.mock.calls.filter((call) => call.length === 3)).toHaveLength(0);
});

test('workout planner grants planning without permission to record performed workouts', async () => {
  const { client, request } = setup();
  await render(<AgentAccess client={client} />);
  await waitFor(() =>
    expect(screen.getByText('No agent access has been issued.')).toBeOnTheScreen(),
  );
  expect(screen.queryByLabelText('Agent name')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Add agent', exact: true }));
  await fireEvent.changeText(screen.getByLabelText('Agent name'), 'Fictional planner');
  await fireEvent.press(screen.getByRole('radio', { name: 'Workout planner' }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Create one-time key' }));
  await waitFor(() => expect(screen.getByLabelText('One-time agent key')).toBeOnTheScreen());
  const body = request.mock.calls.find(
    (call) => call.length === 3 && call[0] === '/api/agent-grants',
  )?.[1] as { scopes: string[] };
  expect(body.scopes).toEqual(['workouts:read', 'workouts:plan']);
  expect(screen.queryByText(/Authorization: Bearer/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Manual setup details' }));
  expect(screen.getByText(/Authorization: Bearer/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Copy key', exact: true }));
  const { setStringAsync } = jest.requireMock('expo-clipboard');
  expect(setStringAsync).toHaveBeenCalledWith(secret);
});

test('hiding a mounted connection page clears its one-time key without dropping grant metadata', async () => {
  const { client } = setup();
  const view = await render(<AgentAccess client={client} active />);
  await create();
  await waitFor(() => expect(screen.getByLabelText('One-time agent key')).toBeOnTheScreen());
  await view.rerender(<AgentAccess client={client} active={false} />);
  expect(screen.queryByLabelText('One-time agent key')).toBeNull();
  await view.rerender(<AgentAccess client={client} active />);
  expect(screen.queryByLabelText('One-time agent key')).toBeNull();
  expect(screen.queryByLabelText('Agent name')).toBeNull();
  expect(screen.getByRole('button', { name: 'Revoke Fictional planner' })).toBeOnTheScreen();
});
