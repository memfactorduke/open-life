import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TaskSchema, defaultPreferences, type AttentionResponse } from '@mems-life/domain';
import { Today } from '../src/features/Today';
import { createInstallationClient } from '../src/client';

jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('../src/offline-client', () => ({ useOfflineRevision: () => 0 }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-12T12:00:00Z';
const task = TaskSchema.parse({
  id: id(1),
  revision: 2,
  phase: 'next',
  content: { title: 'Fictional due task', description: '', notes: '' },
  schedule: { dueAt: now },
  order: 0,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  archivedAt: null,
  deletedAt: null,
});
function day(): AttentionResponse {
  return {
    now,
    timezone: 'UTC',
    date: '2026-10-12',
    items: [
      {
        id: 'due:1',
        sourceId: task.id,
        sourceRevision: 2,
        kind: 'due',
        task,
        step: null,
        waitingReason: null,
        route: { kind: 'task', id: task.id },
        dedupeKey: 'due:1:2',
      },
      {
        id: 'review:2',
        sourceId: id(2),
        sourceRevision: 1,
        kind: 'review',
        task,
        step: null,
        waitingReason: 'review_result',
        route: { kind: 'task', id: task.id },
        dedupeKey: 'review:2:1',
      },
    ],
    activeSession: {
      id: id(3),
      revision: 1,
      name: 'Fictional training',
      notes: '',
      status: 'active',
      sourceRoutineId: null,
      sourceRoutineRevision: null,
      items: [],
      supersets: [],
      timer: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    },
    food: {
      count: 1,
      route: '/food',
      entries: [
        {
          id: id(4),
          revision: 1,
          content: { text: 'Fictional lunch', occurredAt: now, timezone: 'UTC' },
          photoIds: [],
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ],
    },
  };
}

it('opens exact task, workout and food records and keeps capture routes local', async () => {
  const onOpen = jest.fn();
  const request = jest.fn(async () => day());
  const client = { ...createInstallationClient('https://fictional.example'), request };
  await render(
    <Today
      client={client}
      preferences={defaultPreferences({ name: 'Fictional owner', timeZone: 'UTC' })}
      onOpen={onOpen}
    />,
  );
  await screen.findByText('Food today');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue task' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Resume workout' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Open food: Fictional lunch' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Capture a task' }));
  expect(onOpen.mock.calls.map((call) => call[0])).toEqual([
    { kind: 'task', id: id(1) },
    { kind: 'session', id: id(3) },
    { kind: 'food', id: id(4) },
    { kind: 'task', action: 'create' },
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Review needed: Fictional due task' }));
  expect(screen.getAllByText('An agent result is ready for your review.').length).toBeGreaterThan(
    0,
  );
  expect(request).toHaveBeenCalledWith('/api/attention');
});

it('retains last confirmed attention through a failed refresh and recovers explicitly', async () => {
  let failed = false;
  const request = jest.fn(async () => {
    if (failed) throw new Error('Connection interrupted.');
    return day();
  });
  await render(
    <Today
      client={{ ...createInstallationClient('https://fictional.example'), request }}
      preferences={defaultPreferences()}
      onOpen={jest.fn()}
    />,
  );
  await screen.findByText('Food today');
  failed = true;
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh Today' }));
  await screen.findByText('Connection interrupted.');
  expect(
    screen.getByText('Showing your last confirmed view. It may have changed.'),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Resume workout' })).toBeOnTheScreen();
  failed = false;
  await fireEvent.press(screen.getByRole('button', { name: 'Retry Today' }));
  await waitFor(() => expect(screen.queryByText('Connection interrupted.')).toBeNull());
});

it('makes an empty installation actionable without invented statistics', async () => {
  const empty = {
    ...day(),
    items: [],
    activeSession: null,
    food: { count: 0, entries: [], route: '/food' },
  };
  await render(
    <Today
      client={{
        ...createInstallationClient('https://fictional.example'),
        request: jest.fn(async () => empty),
      }}
      preferences={defaultPreferences({ name: 'A very long fictional name '.repeat(12) })}
      onOpen={jest.fn()}
    />,
  );
  await screen.findByText('A clear place to start');
  expect(screen.getByRole('button', { name: 'Capture a task' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Log food' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Open Workouts' })).toBeOnTheScreen();
  expect(screen.queryByText('0 sets recorded')).toBeNull();
});
