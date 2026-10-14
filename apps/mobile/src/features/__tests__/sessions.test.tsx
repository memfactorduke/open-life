import React from 'react';
import {
  act,
  fireEvent,
  render as renderNative,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  SessionCommandSchema,
  defaultPreferences,
  type WorkoutSession,
  type SessionCommand,
} from '@mems-life/domain';
import { Sessions } from '../Sessions';
import {
  createInstallationClient,
  RequestRejectedError,
  type InstallationClient,
} from '../../client';
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
jest.mock('../../timers', () => ({
  deviceIdentity: async () => 'test-device',
  reconcileTimerAlert: async () => '',
  readTimerPreferences: async () => ({ alerts: false, sound: false, haptics: false }),
  saveTimerPreferences: async () => {},
  timerHaptic: async () => {},
}));
let mockSequence = 20;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(mockSequence++).padStart(12, '0')}`,
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instant = '2026-10-12T12:00:00Z';
const fixture = (): WorkoutSession => ({
  id: id(1),
  revision: 1,
  name: 'Fictional training',
  notes: '',
  status: 'active',
  sourceRoutineId: null,
  sourceRoutineRevision: null,
  startedAt: instant,
  updatedAt: instant,
  finishedAt: null,
  timer: null,
  supersets: [],
  items: [
    {
      id: id(2),
      exerciseId: id(3),
      snapshot: { name: 'Fictional press', mode: 'weighted', supportsLoad: true },
      targets: [
        {
          id: id(4),
          kind: 'working',
          measurements: { mode: 'weighted', reps: 8, loadKg: 40 },
          notes: '',
        },
      ],
      status: 'planned',
      notes: '',
      results: [],
      replacedItemId: null,
    },
    {
      id: id(5),
      exerciseId: id(6),
      snapshot: { name: 'Fictional hold', mode: 'timed', supportsLoad: false },
      targets: [],
      status: 'planned',
      notes: '',
      results: [],
      replacedItemId: null,
    },
  ],
});
function fake(failFirst = false, conflict = false) {
  let saved = fixture(),
    attempts = 0;
  const commands: SessionCommand[] = [];
  const request = jest.fn(async (path: string, body?: unknown): Promise<unknown> => {
    if (path === '/api/sessions/clock') return { now: instant };
    if (path === '/api/exercises') return { exercises: [] };
    if (path === '/api/routines') return { routines: [] };
    if (path.includes('/performance?')) return { performances: [], nextCursor: null };
    if (path.endsWith('/history')) return { events: [], nextCursor: null };
    if (!body)
      return path === `/api/sessions/${saved.id}`
        ? { session: saved }
        : { sessions: [saved], nextCursor: null };
    const command = SessionCommandSchema.parse(body);
    commands.push(command);
    if (conflict) throw new RequestRejectedError(409, 'Session changed; review latest.');
    if (failFirst && attempts++ === 0) throw new Error('Connection interrupted.');
    saved = { ...saved, revision: saved.revision + 1 };
    if (command.type === 'session.record-set')
      saved = {
        ...saved,
        items: saved.items.map((item) =>
          item.id === command.itemId
            ? {
                ...item,
                status: 'in-progress',
                results: [
                  ...item.results,
                  {
                    id: command.setId,
                    kind: command.kind,
                    measurements: command.measurements,
                    notes: command.notes,
                    round: command.round,
                    recordedAt: instant,
                    correctedAt: null,
                    removedAt: null,
                  },
                ],
              }
            : item,
        ),
      };
    if (command.type === 'session.finish' || command.type === 'session.abandon')
      saved = {
        ...saved,
        status: command.type === 'session.finish' ? 'completed' : 'abandoned',
        finishedAt: instant,
      };
    return { session: saved, operationId: command.operationId, feedPosition: '1' };
  });
  const client: InstallationClient = {
    ...createInstallationClient('https://fictional.example'),
    request,
  };
  return { client, commands, request };
}
beforeEach(() => {
  mockSequence = 20;
});
it('retains per-exercise inputs, records only applicable actuals in canonical units, and keeps targets separate', async () => {
  const { client, commands } = fake();
  await render(
    <Sessions client={client} preferences={{ ...defaultPreferences(), weightUnit: 'lb' }} />,
  );
  await screen.findByLabelText('Repetitions');
  await fireEvent.changeText(screen.getByLabelText('Repetitions'), '6');
  await fireEvent.changeText(screen.getByLabelText('Load (lb)'), '100');
  await fireEvent.press(screen.getByRole('button', { name: 'Fictional hold · planned · 0 sets' }));
  expect(screen.queryByLabelText('Load (lb)')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Duration (seconds)'), '30');
  await fireEvent.press(screen.getByRole('button', { name: 'Fictional press · planned · 0 sets' }));
  expect(screen.getByLabelText('Repetitions').props.value).toBe('6');
  await fireEvent.press(screen.getByRole('button', { name: 'Record set' }));
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    type: 'session.record-set',
    measurements: { mode: 'weighted', reps: 6, loadKg: 45.359237 },
    expectedRevision: 1,
  });
  await screen.findByText('Planned 1: working · 8 reps · 88.18 lb');
  expect(screen.getByLabelText('Repetitions').props.value).toBe('');
});
it('retries the identical operation after an uncertain response and clears acknowledged inputs', async () => {
  const { client, commands } = fake(true);
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByLabelText('Repetitions');
  await fireEvent.changeText(screen.getByLabelText('Repetitions'), '5');
  await fireEvent.press(screen.getByRole('button', { name: 'Record set' }));
  await screen.findByText('Connection interrupted.');
  expect(screen.getByLabelText('Repetitions').props.value).toBe('5');
  await fireEvent.press(screen.getByRole('button', { name: 'Retry unchanged request' }));
  await waitFor(() => expect(commands).toHaveLength(2));
  expect(commands[1]).toEqual(commands[0]);
  await waitFor(() => expect(screen.getByLabelText('Repetitions').props.value).toBe(''));
});
it('requires explicit finish confirmation and never converts unperformed targets into actuals', async () => {
  const { client, commands } = fake();
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByRole('button', { name: 'Finish workout' });
  await fireEvent.press(screen.getByRole('button', { name: 'Finish workout' }));
  expect(commands).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm finish' }));
  await waitFor(() => expect(commands[0]?.type).toBe('session.finish'));
  await screen.findByText('completed · Saved revision 2');
  expect(screen.queryByText(/^Actual 1:/)).toBeNull();
});
it('keeps rejected input available and offers explicit latest-server review', async () => {
  const { client, commands } = fake(false, true);
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByLabelText('Repetitions');
  await fireEvent.changeText(screen.getByLabelText('Repetitions'), '7');
  await fireEvent.press(screen.getByRole('button', { name: 'Record set' }));
  await screen.findByText('Session changed; review latest.');
  await fireEvent.press(screen.getByRole('button', { name: 'Review latest saved session' }));
  await screen.findByText(/Latest saved revision 1 loaded/);
  expect(screen.getByLabelText('Repetitions').props.value).toBe('7');
  expect(commands).toHaveLength(1);
});

it('finds comparable actuals beyond the initial session list and shows partial and corrected results', async () => {
  const { client, request } = fake();
  const original = request.getMockImplementation()!;
  const result = {
    id: id(70),
    kind: 'working',
    measurements: { mode: 'weighted', reps: 9, loadKg: 55 },
    notes: '',
    round: null,
    recordedAt: instant,
    correctedAt: instant,
    removedAt: null,
  };
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path.includes('/performance?'))
      return {
        performances: [
          {
            sessionId: id(71),
            status: 'abandoned',
            startedAt: instant,
            items: [{ ...fixture().items[0], results: path.includes('cursor=') ? [result] : [] }],
            measuredWorkingVolumeKgReps: path.includes('cursor=') ? 495 : 0,
          },
        ],
        nextCursor: path.includes('cursor=') ? null : id(71),
      };
    return original(path, body);
  });
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByText(/Previous.*9 reps.*55 kg.*corrected.*Partial/);
  expect(request).toHaveBeenCalledWith(
    expect.stringContaining(`mode=weighted&excludeSessionId=${id(1)}`),
  );
  expect(request).toHaveBeenCalledWith(expect.stringContaining(`cursor=${id(71)}`));
});
it('ignores an older performance response after another exercise is selected', async () => {
  const { client, request } = fake();
  const original = request.getMockImplementation()!;
  let complete!: (value: unknown) => void;
  const delayed = new Promise<unknown>((resolve) => {
    complete = resolve;
  });
  request.mockImplementation(async (path: string, body?: unknown) =>
    path.includes(`/api/exercises/${id(3)}/performance?`) ? delayed : original(path, body),
  );
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByLabelText('Repetitions');
  await fireEvent.press(screen.getByRole('button', { name: 'Fictional hold · planned · 0 sets' }));
  await screen.findByLabelText('Duration (seconds)');
  await act(async () => {
    complete({
      performances: [
        {
          sessionId: id(95),
          status: 'completed',
          startedAt: instant,
          items: [
            {
              ...fixture().items[0],
              results: [
                {
                  id: id(96),
                  kind: 'working',
                  measurements: { mode: 'weighted', reps: 99, loadKg: 80 },
                  notes: '',
                  round: null,
                  recordedAt: instant,
                  correctedAt: null,
                  removedAt: null,
                },
              ],
            },
          ],
          measuredWorkingVolumeKgReps: 7920,
        },
      ],
      nextCursor: null,
    });
  });
  expect(screen.queryByText(/Previous.*99 reps/)).toBeNull();
  expect(screen.getByLabelText('Duration (seconds)')).toBeTruthy();
});
it('shows the correction reason, actor type and saved historical results', async () => {
  const { client, request } = fake();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path: string, body?: unknown) =>
    path.endsWith('/history')
      ? {
          events: [
            {
              id: '1',
              operationId: id(80),
              actorId: 'fictional-agent',
              actorType: 'agent',
              reason: 'Corrected transcription of reported load',
              eventType: 'session.correct-set',
              revision: 2,
              session: fixture(),
              createdAt: instant,
            },
          ],
          nextCursor: null,
        }
      : original(path, body),
  );
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByRole('button', { name: 'View correction history' });
  await fireEvent.press(screen.getByRole('button', { name: 'View correction history' }));
  await screen.findByText('Reason: Corrected transcription of reported load');
  expect(screen.getByText(/Agent fictional-agent/)).toBeTruthy();
});
it('retains entered units when preferences change before the actual set is submitted', async () => {
  const { client, commands } = fake();
  const view = await render(
    <Sessions client={client} preferences={{ ...defaultPreferences(), weightUnit: 'lb' }} />,
  );
  await screen.findByLabelText('Load (lb)');
  await fireEvent.changeText(screen.getByLabelText('Repetitions'), '6');
  await fireEvent.changeText(screen.getByLabelText('Load (lb)'), '100');
  await view.rerender(
    <Sessions client={client} preferences={{ ...defaultPreferences(), weightUnit: 'kg' }} />,
  );
  expect(screen.getByLabelText('Load (lb)').props.value).toBe('100');
  await fireEvent.press(screen.getByRole('button', { name: 'Record set' }));
  await waitFor(() => expect(commands[0]).toMatchObject({ measurements: { loadKg: 45.359237 } }));
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));
describe('owned timer alert reconciliation', () => {
  const timers = jest.requireActual<typeof import('../../timers')>('../../timers');
  const storage = jest.requireMock('expo-secure-store');
  const notifications = jest.requireMock('expo-notifications');
  const running = (): WorkoutSession & { timer: NonNullable<WorkoutSession['timer']> } => ({
    ...fixture(),
    timer: {
      id: id(40),
      kind: 'rest' as const,
      state: 'running' as const,
      durationSeconds: 90,
      remainingSeconds: 90,
      deadline: '2026-10-12T12:01:30Z',
      updatedAt: instant,
      clockBasis: 'server' as const,
      initiatingDeviceId: 'test-device',
      itemId: null,
    },
  });
  beforeEach(() => {
    storage.getItemAsync.mockResolvedValue(null);
    storage.setItemAsync.mockResolvedValue(undefined);
    storage.deleteItemAsync.mockResolvedValue(undefined);
    notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    notifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    notifications.scheduleNotificationAsync.mockResolvedValue('new-alert');
    jest.clearAllMocks();
  });
  const input = (session: WorkoutSession) => ({
    installation: 'https://fictional.example',
    session,
    timer: session.timer,
    deviceId: 'test-device',
    enabled: true,
    sound: false,
    haptics: false,
    serverNow: Date.parse(instant),
  });
  it('keeps the saved timer usable when permission is denied', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await timers.reconcileTimerAlert(input(running()))).toMatch(/not allowed/);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
  it('keeps an unchanged scheduled deadline stable across repeated reconciliations', async () => {
    const session = running();
    storage.getItemAsync.mockResolvedValue(
      JSON.stringify({
        id: 'existing-alert',
        signature: `${session.timer.id}:${session.timer.deadline}:false`,
      }),
    );
    notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'existing-alert', content: { data: {} } },
    ]);
    await timers.reconcileTimerAlert(input(session));
    await timers.reconcileTimerAlert({ ...input(session), serverNow: Date.parse(instant) + 5000 });
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
  it('cancels obsolete local alerts when the timer is paused', async () => {
    storage.getItemAsync.mockResolvedValue(JSON.stringify({ id: 'old-alert', signature: 'old' }));
    const session = running();
    session.timer.state = 'paused';
    session.timer.deadline = null;
    await timers.reconcileTimerAlert(input(session));
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-alert');
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
  it('schedules a server-derived interval only on its initiating device', async () => {
    const session = running();
    await timers.reconcileTimerAlert(input(session));
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: { type: 'timeInterval', seconds: 90, repeats: false } }),
    );
    notifications.scheduleNotificationAsync.mockClear();
    session.timer.initiatingDeviceId = 'other-device';
    expect(await timers.reconcileTimerAlert(input(session))).toMatch(/initiating device/);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

it('canceling a saved timer ignores invalid edited duration text', async () => {
  const { client, commands, request } = fake();
  const session = fixture();
  session.timer = {
    id: id(70),
    kind: 'rest',
    clockBasis: 'server',
    state: 'running',
    durationSeconds: 90,
    remainingSeconds: 90,
    deadline: '2026-10-12T12:01:30Z',
    initiatingDeviceId: 'test-device',
    itemId: null,
    updatedAt: instant,
  };
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path: string, body?: unknown) =>
    path === '/api/sessions' && !body
      ? { sessions: [session], nextCursor: null }
      : original(path, body),
  );
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByLabelText('Timer seconds');
  await fireEvent.changeText(screen.getByLabelText('Timer seconds'), 'invalid');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel timer' }));
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    type: 'session.timer',
    action: 'cancel',
    durationSeconds: 90,
    timerId: id(70),
  });
});

it('keeps recorded sets on a removed exercise correctable without allowing new activity', async () => {
  const { client, commands, request } = fake();
  const session = fixture();
  session.items[0]!.status = 'removed';
  session.items[0]!.results = [
    {
      id: id(75),
      kind: 'working',
      measurements: { mode: 'weighted', reps: 6, loadKg: 40 },
      notes: '',
      round: null,
      recordedAt: instant,
      correctedAt: null,
      removedAt: null,
    },
  ];
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path: string, body?: unknown) =>
    path === '/api/sessions' && !body
      ? { sessions: [session], nextCursor: null }
      : original(path, body),
  );
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByRole('button', { name: 'Fictional press · removed · 1 sets' });
  await fireEvent.press(screen.getByRole('button', { name: 'Fictional press · removed · 1 sets' }));
  expect(screen.queryByRole('button', { name: 'Record set' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Correct actual set 1' }));
  await fireEvent.changeText(screen.getByLabelText('Repetitions'), '7');
  await fireEvent.changeText(
    screen.getByLabelText('Correction reason'),
    'Corrected counting error',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save correction' }));
  await waitFor(() =>
    expect(commands[0]).toMatchObject({
      type: 'session.correct-set',
      setId: id(75),
      measurements: { reps: 7 },
    }),
  );
});

it('recording an actual set preserves an unsubmitted exercise note', async () => {
  const { client } = fake();
  await render(<Sessions client={client} preferences={defaultPreferences()} />);
  await screen.findByLabelText('Repetitions');
  await fireEvent.changeText(
    screen.getByLabelText('Exercise session notes'),
    'Adjust grip next set',
  );
  await fireEvent.changeText(screen.getByLabelText('Repetitions'), '6');
  await fireEvent.press(screen.getByRole('button', { name: 'Record set' }));
  await waitFor(() => expect(screen.getByLabelText('Repetitions').props.value).toBe(''));
  expect(screen.getByLabelText('Exercise session notes').props.value).toBe('Adjust grip next set');
});
