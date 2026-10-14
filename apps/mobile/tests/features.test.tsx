import React from 'react';
import {
  act,
  fireEvent,
  render as renderNative,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import {
  TaskCommandSchema,
  RoutineCommandSchema,
  type Task,
  defaultPreferences,
} from '@mems-life/domain';
import { Tasks } from '../src/features/Tasks';
import { Workouts } from '../src/features/Workouts';
import {
  createInstallationClient,
  RequestRejectedError,
  type InstallationClient,
} from '../src/client';
const testMetrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, bottom: 34, left: 0, right: 0 },
};
// Native inset events do not run in Jest; seed the same app-root context as a phone.
const render = (element: React.ReactElement) =>
  renderNative(element, {
    wrapper: ({ children }) => (
      <SafeAreaProvider initialMetrics={testMetrics}>{children}</SafeAreaProvider>
    ),
  });

jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo-secure-store', () => ({}));

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const instant = '2026-10-12T12:00:00Z';
const id = '00000000-0000-4000-8000-000000000001';
let sequence = 10;
beforeEach(() => {
  sequence = 10;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`);
});
function clientWith(request: jest.Mock): InstallationClient {
  return {
    ...createInstallationClient('https://fictional.example'),
    request,
  };
}

it('retains capture text and replays the exact failed operation instead of making a second task', async () => {
  let saved: Task | null = null;
  let attempts = 0;
  const request = jest.fn(async (path: string, body?: unknown) => {
    if (!body) return { tasks: saved ? [saved] : [] };
    if (++attempts === 1) throw new Error('Connection lost.');
    const command = TaskCommandSchema.parse(body);
    if (command.type !== 'task.create') throw new Error('Expected task capture.');
    saved = {
      id: command.taskId,
      revision: 1,
      phase: 'planned',
      content: command.content,
      order: 0,
      createdAt: instant,
      updatedAt: instant,
      completedAt: null,
      archivedAt: null,
      deletedAt: null,
    };
    return {
      operationId: command.operationId,
      task: saved,
      changedTasks: [saved],
      feedPosition: '1',
    };
  });
  await render(<Tasks client={clientWith(request)} />);
  await waitFor(() =>
    expect(
      screen.getByText('No tasks in this phase. Capture one above or move a task here.'),
    ).toBeOnTheScreen(),
  );
  await fireEvent.changeText(screen.getByLabelText('New task'), 'Book a fictional appointment');
  await fireEvent.press(screen.getByRole('button', { name: 'Add to Planned' }));
  await waitFor(() => expect(screen.getByText('Connection lost.')).toBeOnTheScreen());
  expect(screen.getByLabelText('New task').props.value).toBe('Book a fictional appointment');
  await fireEvent.press(screen.getByRole('button', { name: 'Retry task capture' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Book a fictional appointment' })).toBeOnTheScreen(),
  );
  const commands = request.mock.calls.filter((call) => call[1]);
  expect(commands[1]?.[1]).toEqual(commands[0]?.[1]);
  expect(commands[0]?.[1]).toMatchObject({
    type: 'task.create',
    expectedRevision: 0,
    content: { title: 'Book a fictional appointment', description: '', notes: '' },
  });
  expect(screen.getByLabelText('New task').props.value).toBe('');
});

it('edits a task with its revision and retains notes after server rejection', async () => {
  const task = {
    id,
    revision: 7,
    phase: 'planned',
    content: { title: 'Fictional task', description: 'Context', notes: 'Original note' },
    order: 0,
    createdAt: instant,
    updatedAt: instant,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
  };
  const request = jest.fn(async (path: string, body?: unknown) => {
    if (body) throw new RequestRejectedError(409, 'Task changed. Refresh before trying again.');
    return path.endsWith('/history') ? { events: [], nextCursor: null } : { tasks: [task] };
  });
  await render(<Tasks client={clientWith(request)} />);
  await screen.findByRole('button', { name: 'Fictional task' });
  await fireEvent.press(screen.getByRole('button', { name: 'Fictional task' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Edit task' }));
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'Keep this draft');
  await fireEvent.press(screen.getByRole('button', { name: 'Save task' }));
  await screen.findByText('Task changed. Refresh before trying again.');
  expect(screen.getByLabelText('Notes').props.value).toBe('Keep this draft');
  expect(screen.getByLabelText('Notes').props.editable).toBe(true);
  expect(request.mock.calls.find((call) => call[1])?.[1]).toMatchObject({
    type: 'task.edit',
    taskId: id,
    expectedRevision: 7,
    content: { title: 'Fictional task', description: 'Context', notes: 'Keep this draft' },
  });
});

it('builds a weighted routine in pounds while saving canonical kilograms and an absent reps target', async () => {
  const exercise = {
    id,
    revision: 1,
    name: 'Fictional press',
    mode: 'weighted',
    supportsLoad: true,
    notes: '',
    origin: 'custom',
    archivedAt: null,
    createdAt: instant,
    updatedAt: instant,
  };
  const request = jest.fn(async (path: string, body?: unknown) => {
    if (body) {
      const command = RoutineCommandSchema.parse(body);
      if (command.type !== 'routine.create') throw new Error('Expected routine capture.');
      return {
        operationId: command.operationId,
        routine: {
          ...command.content,
          id: command.routineId,
          revision: 1,
          archivedAt: null,
          createdAt: instant,
          updatedAt: instant,
        },
        feedPosition: '1',
      };
    }
    if (path === '/api/exercises?view=archived') return { exercises: [] };
    return path === '/api/exercises' ? { exercises: [exercise] } : { routines: [] };
  });
  await render(
    <Workouts
      client={clientWith(request)}
      preferences={{ ...defaultPreferences, weightUnit: 'lb' }}
    />,
  );
  await screen.findByText('No routines here yet. Build a plan with exercises, targets and notes.');
  await fireEvent.press(screen.getByRole('button', { name: 'Create routine' }));
  await fireEvent.changeText(screen.getByLabelText('Routine name'), 'Fictional push day');
  await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
  await screen.findByRole('button', { name: 'Add Fictional press' });
  await fireEvent.press(screen.getByRole('button', { name: 'Add Fictional press' }));
  await fireEvent.press(screen.getByRole('button', { name: '1. Fictional press' }));
  await fireEvent.changeText(screen.getByLabelText('Load (lb) for set 1'), '100');
  await fireEvent.press(screen.getByRole('button', { name: 'Save routine' }));
  await waitFor(() => {
    const command = RoutineCommandSchema.parse(request.mock.calls.find((call) => call[1])?.[1]);
    if (command.type !== 'routine.create') throw new Error('Expected routine capture.');
    expect(command.content.items[0]?.targets[0]?.measurements).toEqual({
      mode: 'weighted',
      reps: null,
      loadKg: 45.359237,
    });
  });
});

it('keeps invalid numeric input visible and prevents saving an older valid target', async () => {
  const exercise = {
    id,
    revision: 1,
    name: 'Fictional press',
    mode: 'weighted',
    supportsLoad: true,
    notes: '',
    origin: 'custom',
    archivedAt: null,
    createdAt: instant,
    updatedAt: instant,
  };
  const request = jest.fn(async (path: string) =>
    path.startsWith('/api/exercises')
      ? { exercises: path.includes('?') ? [] : [exercise] }
      : { routines: [] },
  );
  await render(<Workouts client={clientWith(request)} preferences={defaultPreferences} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Create routine' }));
  await fireEvent.changeText(screen.getByLabelText('Routine name'), 'Invalid target plan');
  await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
  await screen.findByRole('button', { name: 'Add Fictional press' });
  await fireEvent.press(screen.getByRole('button', { name: 'Add Fictional press' }));
  await fireEvent.press(screen.getByRole('button', { name: '1. Fictional press' }));
  await fireEvent.changeText(screen.getByLabelText('Repetitions for set 1'), 'eight');
  expect(screen.getByLabelText('Repetitions for set 1').props.value).toBe('eight');
  expect(screen.getByRole('button', { name: 'Save routine' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '1. Fictional press' }));
  expect(screen.getByRole('button', { name: 'Save routine' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '1. Fictional press' }));
  expect(screen.getByLabelText('Repetitions for set 1').props.value).toBe('eight');
  await fireEvent.changeText(screen.getByLabelText('Repetitions for set 1'), '0');
  expect(screen.getByRole('button', { name: 'Save routine' })).toBeEnabled();
});

it('a late task query cannot replace a newly selected completed-history view', async () => {
  let resolveOpen!: (value: unknown) => void;
  const completed = {
    id,
    revision: 1,
    phase: 'completed',
    content: { title: 'Completed fictional task', description: '', notes: '' },
    order: 0,
    createdAt: instant,
    updatedAt: instant,
    completedAt: instant,
    archivedAt: null,
    deletedAt: null,
  };
  const request = jest.fn((path: string) => {
    if (path.includes('/api/tasks/query?view=open'))
      return new Promise((resolve) => {
        resolveOpen = resolve;
      });
    if (path.includes('/api/tasks/query?view=completed'))
      return Promise.resolve({ tasks: [completed] });
    return Promise.resolve({ boards: [], projects: [], series: [] });
  });
  await render(<Tasks client={clientWith(request)} />);
  await waitFor(() => expect(resolveOpen).toBeDefined());
  await fireEvent.press(screen.getByRole('button', { name: 'More' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Completed' }));
  await screen.findByRole('button', { name: 'Completed fictional task' });
  await act(async () => resolveOpen({ tasks: [] }));
  expect(screen.getByRole('button', { name: 'Completed fictional task' })).toBeOnTheScreen();
});
