import React from 'react';
import { useWindowDimensions } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TaskSchema, defaultPreferences, type AttentionResponse } from '@mems-life/domain';
import { Today } from '../src/features/Today';
import { createInstallationClient } from '../src/client';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: jest.fn(() => ({ width: 1100, height: 900, scale: 1, fontScale: 1 })),
}));
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
  await screen.findByText('Food today · 1');
  await fireEvent.press(screen.getByRole('button', { name: 'Due now: Fictional due task' }));
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
  expect(screen.getAllByText('Review the agent result.').length).toBeGreaterThan(0);
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
  await screen.findByText('Food today · 1');
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
  await screen.findByText('Nothing needs your attention.');
  expect(screen.getByRole('button', { name: 'Capture a task' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Log food' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Start workout' })).toBeOnTheScreen();
  expect(screen.queryByText('0 sets recorded')).toBeNull();
});

it('collapses only waiting work and opens ready or failed rows in one tap', async () => {
  const projection = day();
  projection.items.push(
    { ...projection.items[0]!, id: 'waiting:3', kind: 'waiting', waitingReason: 'agent' },
    { ...projection.items[0]!, id: 'failure:4', kind: 'failure', waitingReason: 'agent_failed' },
    {
      ...projection.items[0]!,
      id: 'unknown:5',
      kind: 'outcome-unknown',
      waitingReason: 'reconcile_agent_outcome',
    },
  );
  const onOpen = jest.fn();
  await render(
    <Today
      client={{
        ...createInstallationClient('https://fictional.example'),
        request: jest.fn(async () => projection),
      }}
      preferences={defaultPreferences()}
      onOpen={onOpen}
    />,
  );
  await screen.findByText('Needs you · 4');
  expect(screen.queryByRole('button', { name: 'Waiting: Fictional due task' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Agent needs help: Fictional due task' }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Outcome needs checking: Fictional due task' }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Waiting · 1' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Waiting: Fictional due task' }));
  expect(onOpen).toHaveBeenLastCalledWith({ kind: 'task', id: id(1) });
  expect(screen.getAllByRole('button', { name: 'Resume workout' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Continue task' })).toBeNull();
  expect(screen.queryByText(/Hello,/)).toBeNull();
});

it('uses the measured content width to choose columns, including compact iPad content', async () => {
  await render(
    <Today
      client={{
        ...createInstallationClient('https://fictional.example'),
        request: jest.fn(async () => day()),
      }}
      preferences={defaultPreferences()}
      onOpen={jest.fn()}
    />,
  );
  const content = await screen.findByTestId('today-content');
  await fireEvent(content, 'layout', {
    nativeEvent: { layout: { width: 650, height: 500, x: 0, y: 0 } },
  });
  expect(content).not.toHaveStyle({ flexDirection: 'row' });
  await fireEvent(content, 'layout', {
    nativeEvent: { layout: { width: 740, height: 500, x: 0, y: 0 } },
  });
  expect(screen.getByTestId('today-content')).toHaveStyle({ flexDirection: 'row' });
});

it('keeps large text in a single readable column even with wide content', async () => {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 1100, height: 900, scale: 1, fontScale: 2 });
  await render(
    <Today
      client={{
        ...createInstallationClient('https://fictional.example'),
        request: jest.fn(async () => day()),
      }}
      preferences={defaultPreferences()}
      onOpen={jest.fn()}
    />,
  );
  const content = await screen.findByTestId('today-content');
  await fireEvent(content, 'layout', {
    nativeEvent: { layout: { width: 900, height: 500, x: 0, y: 0 } },
  });
  expect(screen.getByTestId('today-content')).not.toHaveStyle({ flexDirection: 'row' });
});

it('ignores a late refresh after Today becomes inactive', async () => {
  let resolve!: (value: AttentionResponse) => void;
  const response = new Promise<AttentionResponse>((done) => {
    resolve = done;
  });
  const client = {
    ...createInstallationClient('https://fictional.example'),
    request: jest.fn(() => response),
  };
  const preferences = defaultPreferences();
  const onOpen = jest.fn();
  const view = await render(<Today client={client} preferences={preferences} onOpen={onOpen} />);
  await view.rerender(
    <Today client={client} preferences={preferences} onOpen={onOpen} active={false} />,
  );
  await act(async () => {
    resolve(day());
    await response;
  });
  expect(screen.queryByRole('button', { name: 'Resume workout' })).toBeNull();
  expect(screen.queryByText('Needs you · 2')).toBeNull();
});

it('stacks the Today header at accessibility sizes and preserves loaded content across font changes', async () => {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  const request = jest.fn(async () => day());
  const client = { ...createInstallationClient('https://fictional.example'), request };
  const preferences = defaultPreferences();
  const onOpen = jest.fn();
  const view = await render(<Today client={client} preferences={preferences} onOpen={onOpen} />);
  await screen.findByText('Food today · 1');
  expect(screen.getByTestId('today-header')).toHaveStyle({ flexDirection: 'row' });
  for (const fontScale of [1.95, 3.1]) {
    jest
      .mocked(useWindowDimensions)
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
    await view.rerender(<Today client={client} preferences={preferences} onOpen={onOpen} />);
    expect(screen.getByTestId('today-header')).toHaveStyle({
      flexDirection: 'column',
      alignItems: 'stretch',
    });
    expect(screen.getByText('Today').parent).toHaveStyle({ width: '100%', flex: 0 });
    expect(screen.getByRole('button', { name: 'Refresh Today' })).toBeOnTheScreen();
    expect(screen.getByText('Food today · 1')).toBeOnTheScreen();
  }
  expect(request).toHaveBeenCalledTimes(1);
});

it('shows the newest three unordered food entries, keeps the full count, and opens the exact newest entry', async () => {
  const projection = day();
  const entry = projection.food.entries[0]!;
  projection.food = {
    count: 4,
    route: '/food',
    entries: [
      {
        ...entry,
        id: id(5),
        content: { ...entry.content, text: 'Older breakfast', occurredAt: '2026-10-12T07:00:00Z' },
      },
      {
        ...entry,
        id: id(8),
        content: { ...entry.content, text: 'Newest dinner', occurredAt: '2026-10-12T19:00:00Z' },
      },
      {
        ...entry,
        id: id(6),
        content: { ...entry.content, text: 'Recent lunch', occurredAt: '2026-10-12T12:00:00Z' },
      },
      {
        ...entry,
        id: id(7),
        content: { ...entry.content, text: 'Recent snack', occurredAt: '2026-10-12T15:00:00Z' },
      },
    ],
  };
  const onOpen = jest.fn();
  await render(
    <Today
      client={{
        ...createInstallationClient('https://fictional.example'),
        request: jest.fn(async () => projection),
      }}
      preferences={defaultPreferences()}
      onOpen={onOpen}
    />,
  );
  await screen.findByText('Food today · 4');
  const rows = screen.getAllByRole('button', { name: /^Open food:/ });
  expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
    'Open food: Newest dinner',
    'Open food: Recent snack',
    'Open food: Recent lunch',
  ]);
  expect(screen.queryByText('Older breakfast')).toBeNull();
  expect(screen.getByRole('button', { name: 'View food diary' })).toBeOnTheScreen();
  await fireEvent.press(rows[0]!);
  expect(onOpen).toHaveBeenLastCalledWith({ kind: 'food', id: id(8) });
});
