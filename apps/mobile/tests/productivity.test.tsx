import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import {
  TaskSchema,
  StepCommandSchema,
  RecurrenceCommandSchema,
  BoardCommandSchema,
  type Task,
  defaultPreferences,
} from '@mems-life/domain';
import { Configuration, Recurrence, Steps, localInstant } from '../src/features/Productivity';
import { Tasks } from '../src/features/Tasks';
import {
  createInstallationClient,
  RequestRejectedError,
  type InstallationClient,
} from '../src/client';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-10-12T12:00:00Z';
let sequence = 10;
beforeEach(() => {
  sequence = 10;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`);
});
const fixture = (): Task =>
  TaskSchema.parse({
    id,
    revision: 4,
    phase: 'planned',
    content: { title: 'Fictional outcome', description: '', notes: '' },
    order: 0,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
  });
function client(request: jest.Mock): InstallationClient {
  return { ...createInstallationClient('https://fictional.example'), request };
}

it('converts due dates in the selected time zone and handles DST deterministically', () => {
  expect(localInstant('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T07:30:00Z');
  expect(localInstant('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00Z');
  expect(localInstant('', '', 'UTC')).toBeNull();
  expect(() => localInstant('2026-10-12', '', 'UTC')).toThrow('Enter a date');
});

it('replays exactly one immutable board command after a lost response', async () => {
  let attempts = 0;
  const request = jest.fn(async (_path, body) => {
    const cmd = BoardCommandSchema.parse(body);
    if (++attempts === 1) throw new Error('Lost response');
    return {
      operationId: cmd.operationId,
      feedPosition: '1',
      record: { id: cmd.id, revision: 1, createdAt: at, updatedAt: at, content: cmd.content },
    };
  });
  await render(
    <Configuration client={client(request)} boards={[]} projects={[]} onSaved={jest.fn()} />,
  );
  await fireEvent.changeText(screen.getByLabelText('Configuration name'), 'Fictional board');
  await fireEvent.changeText(screen.getByLabelText('Column 2 name'), 'Ready for consideration');
  await fireEvent.press(screen.getByRole('button', { name: 'Save configuration' }));
  await screen.findByText('Lost response');
  await fireEvent.press(screen.getByRole('button', { name: 'Retry unchanged configuration' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[1][1]).toEqual(request.mock.calls[0][1]);
  expect(request.mock.calls[0][1].content.columns[1]).toMatchObject({
    name: 'Ready for consideration',
    phase: 'next',
  });
});

it('keeps steps dormant in Planned and sends required human work with parent revision', async () => {
  const task = fixture();
  const stepId = '00000000-0000-4000-8000-000000000002';
  const step = {
    id: stepId,
    taskId: id,
    revision: 1,
    content: {
      title: 'Fictional prerequisite',
      instructions: '',
      responsibility: 'human',
      required: true,
      dependencies: [],
      order: 0,
    },
    status: 'pending',
    assignedTo: null,
    createdAt: at,
    updatedAt: at,
  };
  const response = {
    task,
    entries: [{ step, ready: false, waitingReason: 'not_released' }],
    nextActions: [],
    canComplete: false,
  };
  const request = jest.fn(async (_path, body) => {
    if (!body) return response;
    StepCommandSchema.parse(body);
    throw new RequestRejectedError(400, 'Dependencies must not form a cycle.');
  });
  await render(<Steps task={task} client={client(request)} onTask={jest.fn()} />);
  await screen.findByText('Waiting for deliberate release to Next · Assigned: Unassigned');
  await fireEvent.press(screen.getByRole('button', { name: 'Options for Fictional prerequisite' }));
  expect(
    screen.getByRole('button', { name: 'Mark complete: Fictional prerequisite' }),
  ).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Create a step' }));
  await fireEvent.changeText(screen.getByLabelText('Step title'), 'Fictional branch');
  await fireEvent.press(screen.getByRole('button', { name: 'Require: Fictional prerequisite' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add step' }));
  await screen.findByText('Dependencies must not form a cycle.');
  expect(screen.getByLabelText('Step title').props.value).toBe('Fictional branch');
  const cmd = StepCommandSchema.parse(request.mock.calls.find((c) => c[1])![1]);
  expect(cmd).toMatchObject({
    type: 'step.create',
    expectedTaskRevision: 4,
    expectedRevision: 0,
    content: { responsibility: 'human', required: true, dependencies: [stepId] },
  });
});

it('retains recurrence edits after a stale rejection and reviews saved values before resubmission', async () => {
  const series = {
    id,
    revision: 2,
    content: { title: 'Fictional weekly responsibility', description: '', notes: '' },
    rule: {
      frequency: 'weekly',
      timeZone: 'America/New_York',
      time: '09:00',
      startDate: '2026-10-12',
      weekdays: [1],
      monthDay: 1,
    },
    cancelledAt: null,
    createdAt: at,
    updatedAt: at,
  };
  let latest = series;
  let attempts = 0;
  const request = jest.fn(async (_path, body) => {
    if (!body) return { series: [latest] };
    const cmd = RecurrenceCommandSchema.parse(body);
    if (++attempts === 1) {
      latest = { ...series, revision: 3 };
      throw new RequestRejectedError(409, 'Series changed');
    }
    if (cmd.type !== 'series.edit') throw new Error('Expected edit');
    latest = { ...latest, revision: 4, content: cmd.content, rule: cmd.rule };
    return { ...{ series: latest }, operationId: cmd.operationId, feedPosition: '3' };
  });
  await render(<Recurrence client={client(request)} zone="America/New_York" onSaved={jest.fn()} />);
  await fireEvent.press(
    await screen.findByRole('radio', { name: 'Fictional weekly responsibility' }),
  );
  await fireEvent.changeText(screen.getByLabelText('Series title'), 'Retained future edit');
  await fireEvent.press(screen.getByRole('button', { name: 'Save future recurrence' }));
  await screen.findByText('Series changed');
  expect(screen.getByLabelText('Series title').props.value).toBe('Retained future edit');
  await fireEvent.press(screen.getByRole('button', { name: 'Review latest recurrence' }));
  await screen.findByRole('button', { name: 'Save reviewed future recurrence' });
  await fireEvent.press(screen.getByRole('button', { name: 'Save reviewed future recurrence' }));
  await waitFor(() => expect(attempts).toBe(2));
  const commands = request.mock.calls.filter((c) => c[1]).map((c) => c[1]);
  expect(commands[1]).toMatchObject({
    expectedRevision: 3,
    content: { title: 'Retained future edit' },
  });
  expect(commands[1].operationId).not.toBe(commands[0].operationId);
});

it('retains task drafts when details close and reopen within the task panel', async () => {
  const task = fixture();
  const request = jest.fn(async (path) => {
    if (path === '/api/boards') return { boards: [] };
    if (path === '/api/projects') return { projects: [] };
    if (path === '/api/recurrence') return { series: [] };
    if (path.endsWith('/history')) return { events: [], nextCursor: null };
    if (path.endsWith('/steps')) return { task, entries: [], nextActions: [], canComplete: true };
    return { tasks: [task], nextCursor: null };
  });
  await render(<Tasks client={client(request)} preferences={defaultPreferences} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Fictional outcome' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Edit task' }));
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'Retained unsaved note');
  await fireEvent.press(screen.getByRole('button', { name: 'Close task details' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Fictional outcome' }));
  expect(screen.getByLabelText('Notes').props.value).toBe('Retained unsaved note');
});

it('opens ordinary tasks for reading and action without starting agent setup', async () => {
  const task = fixture();
  const request = jest.fn(async (path) => {
    if (path === '/api/boards') return { boards: [] };
    if (path === '/api/projects') return { projects: [] };
    if (path.endsWith('/history')) return { events: [], nextCursor: null };
    if (path.endsWith('/steps')) return { task, entries: [], nextActions: [], canComplete: true };
    return { tasks: [task], nextCursor: null };
  });
  await render(<Tasks client={client(request)} />);
  expect(screen.queryByRole('radio', { name: 'Completed' })).toBeNull();
  await fireEvent.press(await screen.findByRole('button', { name: 'Fictional outcome' }));
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(screen.getByRole('button', { name: 'Release to Next' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Close task details' })).toBeEnabled();
  await waitFor(() =>
    expect(request.mock.calls.some(([path]) => path.endsWith('/steps'))).toBe(true),
  );
  expect(
    request.mock.calls.some(([path]) => path.includes('skills') || path.includes('workflow')),
  ).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Edit task' }));
  expect(screen.getByLabelText('Title').props.value).toBe('Fictional outcome');
});

it('keeps a released outcome incomplete while required work remains', async () => {
  const task = fixture();
  task.phase = 'next';
  const request = jest.fn(async (path) => {
    if (path === '/api/boards') return { boards: [] };
    if (path === '/api/projects') return { projects: [] };
    if (path.endsWith('/history')) return { events: [], nextCursor: null };
    if (path.endsWith('/steps')) return { task, entries: [], nextActions: [], canComplete: false };
    return { tasks: [task], nextCursor: null };
  });
  await render(<Tasks client={client(request)} />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Next' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Fictional outcome' }));
  await waitFor(() =>
    expect(request.mock.calls.some(([path]) => path.endsWith('/steps'))).toBe(true),
  );
  expect(screen.queryByRole('button', { name: 'Complete task' })).toBeNull();
  expect(request.mock.calls.every((call) => call.length === 1)).toBe(true);
});
