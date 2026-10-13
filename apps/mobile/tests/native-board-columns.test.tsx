import React from 'react';
import { useWindowDimensions } from 'react-native';
import * as Crypto from 'expo-crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { BoardSchema, TaskSchema, type Board, type Task } from '@mems-life/domain';
import { Tasks } from '../src/features/Tasks';
import { createInstallationClient } from '../src/client';

jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-12T12:00:00Z';
function boardFixture(): Board {
  return BoardSchema.parse({
    id: uuid(1),
    revision: 4,
    createdAt: at,
    updatedAt: at,
    content: {
      name: 'Fictional board',
      columns: [
        { id: uuid(2), name: 'Ideas', phase: 'planned' },
        { id: uuid(3), name: 'Research', phase: 'planned' },
        { id: uuid(4), name: 'Ready', phase: 'next' },
        { id: uuid(5), name: 'Doing', phase: 'active' },
      ],
    },
  });
}
function task(n: number, title: string, columnId: string | null, phase = 'planned'): Task {
  return TaskSchema.parse({
    id: uuid(n),
    revision: 7,
    phase,
    content: { title, description: '', notes: '' },
    order: n,
    organization: { boardId: columnId ? uuid(1) : null, columnId },
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
  });
}
const tasks = [
  task(10, 'Fictional idea', uuid(2)),
  task(11, 'Fictional research', uuid(3)),
  task(12, 'Fictional unassigned', null),
  task(13, 'Fictional next', uuid(4), 'next'),
  task(14, 'Fictional active', uuid(5), 'active'),
];
function setup(board = boardFixture(), returnedTasks = tasks) {
  const request = jest.fn(async (path: string) => {
    if (path === '/api/boards') return { boards: [board] };
    if (path === '/api/projects') return { projects: [] };
    if (path === '/api/recurrence') return { series: [] };
    if (path.startsWith('/api/tasks/query')) {
      const boardId = new URL(path, 'https://fictional.example').searchParams.get('boardId');
      return { tasks: returnedTasks.filter((t) => !boardId || t.organization.boardId === boardId) };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  return { client: { ...createInstallationClient('https://fictional.example'), request }, request };
}
async function selectBoard() {
  await fireEvent.press(screen.getByRole('button', { name: 'Find and filter work' }));
  await screen.findByRole('radio', { name: 'Fictional board' });
  await fireEvent.press(screen.getByRole('radio', { name: 'Fictional board' }));
  await waitFor(() => expect(screen.queryByText('Fictional unassigned')).toBeNull());
}
beforeEach(() => {
  let sequence = 100;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => uuid(sequence++));
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 1100, height: 900, scale: 1, fontScale: 1 });
});

it('renders two configured columns in the same phase with distinct tasks and stable IDs', async () => {
  const { client, request } = setup();
  await render(<Tasks client={client} />);
  await selectBoard();
  const ideas = within(screen.getByTestId(`task-group-${uuid(2)}`));
  const research = within(screen.getByTestId(`task-group-${uuid(3)}`));
  expect(ideas.getByText('Fictional idea')).toBeTruthy();
  expect(ideas.queryByText('Fictional research')).toBeNull();
  expect(research.getByText('Fictional research')).toBeTruthy();
  expect(research.queryByText('Fictional idea')).toBeNull();
  expect(request.mock.calls.every((call) => call.length === 1)).toBe(true);
});

it('offers actual columns on a phone through accessible checked radio choices', async () => {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  const { client, request } = setup();
  await render(<Tasks client={client} />);
  await selectBoard();
  expect(screen.getByRole('radio', { name: 'Ideas' }).props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByRole('radio', { name: 'Research' }));
  expect(screen.getByRole('radio', { name: 'Research' }).props.accessibilityState.checked).toBe(
    true,
  );
  expect(screen.getByText('Fictional research')).toBeTruthy();
  expect(screen.queryByText('Fictional idea')).toBeNull();
  expect(request.mock.calls.every((call) => call.length === 1)).toBe(true);
});

it('keeps selection and task phase when a column is renamed to an execution label', async () => {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  const initial = setup();
  const rendered = await render(<Tasks client={initial.client} />);
  await selectBoard();
  await fireEvent.press(screen.getByRole('radio', { name: 'Research' }));
  const renamed = boardFixture();
  renamed.content.columns[1]!.name = 'Active';
  const latest = setup(renamed);
  await rendered.rerender(<Tasks client={latest.client} />);
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Active' }).props.accessibilityState.checked).toBe(
      true,
    ),
  );
  expect(
    within(screen.getByTestId(`task-group-${uuid(3)}`)).getByText('Fictional research'),
  ).toBeTruthy();
  expect(tasks[1]).toMatchObject({
    revision: 7,
    phase: 'planned',
    organization: { columnId: uuid(3) },
  });
  expect(latest.request.mock.calls.every((call) => call.length === 1)).toBe(true);
});

it('keeps default phase groups and valid unassigned work findable in All boards', async () => {
  const { client } = setup();
  await render(<Tasks client={client} />);
  await screen.findByText('Fictional unassigned');
  expect(
    within(screen.getByTestId('task-group-planned')).getByText('Fictional unassigned'),
  ).toBeTruthy();
  expect(within(screen.getByTestId('task-group-next')).getByText('Fictional next')).toBeTruthy();
  expect(
    within(screen.getByTestId('task-group-active')).getByText('Fictional active'),
  ).toBeTruthy();
});

it('keeps stale unmatched column records reachable without merging them into a configured column', async () => {
  const unmatched = task(15, 'Fictional stale column', uuid(99));
  const { client } = setup(boardFixture(), [...tasks, unmatched]);
  await render(<Tasks client={client} />);
  await selectBoard();
  expect(
    within(screen.getByTestId('task-group-unassigned')).getByText('Fictional stale column'),
  ).toBeTruthy();
});
