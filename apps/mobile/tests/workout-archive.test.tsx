import React from 'react';
import {
  act,
  fireEvent,
  render as renderNative,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { defaultPreferences, type Exercise, type Routine } from '@mems-life/domain';
import { Workouts } from '../src/features/Workouts';
import { createInstallationClient, type InstallationClient } from '../src/client';
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
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));

const instant = '2026-10-12T12:00:00Z';
const exercise: Exercise = {
  id: '00000000-0000-4000-8000-000000000001',
  revision: 4,
  name: 'Fictional archived press',
  mode: 'weighted',
  supportsLoad: true,
  notes: '',
  origin: 'custom',
  archivedAt: instant,
  createdAt: instant,
  updatedAt: instant,
};
const routine: Routine = {
  id: '00000000-0000-4000-8000-000000000002',
  revision: 7,
  name: 'Fictional archived routine',
  notes: '',
  items: [],
  archivedAt: instant,
  createdAt: instant,
  updatedAt: instant,
};
function clientWith(request: jest.Mock): InstallationClient {
  return { ...createInstallationClient('https://fictional.example'), request };
}

it('loads archived routines and exercises, unarchives their saved revisions and refreshes both views', async () => {
  let savedExercise = { ...exercise };
  let savedRoutine = { ...routine };
  const request = jest.fn(async (path: string, body?: { type: string; operationId: string }) => {
    if (body) {
      if (body.type === 'exercise.unarchive') {
        savedExercise = {
          ...savedExercise,
          archivedAt: null,
          revision: savedExercise.revision + 1,
        };
        return { operationId: body.operationId, exercise: savedExercise, feedPosition: '1' };
      }
      if (body.type === 'routine.unarchive') {
        savedRoutine = { ...savedRoutine, archivedAt: null, revision: savedRoutine.revision + 1 };
        return { operationId: body.operationId, routine: savedRoutine, feedPosition: '2' };
      }
      throw new Error('Unexpected command');
    }
    const archived = path.includes('view=archived');
    if (path.startsWith('/api/exercises'))
      return { exercises: Boolean(savedExercise.archivedAt) === archived ? [savedExercise] : [] };
    return { routines: Boolean(savedRoutine.archivedAt) === archived ? [savedRoutine] : [] };
  });
  await render(<Workouts client={clientWith(request)} preferences={defaultPreferences} />);
  await screen.findByText('No routines here yet. Build a plan with exercises, targets and notes.');
  await fireEvent.press(screen.getByRole('radio', { name: 'Archived' }));
  await screen.findByText(routine.name);
  await fireEvent.press(screen.getByRole('button', { name: `Edit routine ${routine.name}` }));
  await fireEvent.press(screen.getByRole('button', { name: 'More routine options' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Unarchive routine' }));
  await screen.findByRole('button', { name: 'Archive routine' });
  await fireEvent.press(screen.getByRole('button', { name: 'Close routine' }));
  await waitFor(() => expect(screen.queryByText(routine.name)).toBeNull());
  await fireEvent.press(screen.getByRole('radio', { name: 'Current' }));
  await screen.findByText(routine.name);
  await fireEvent.press(screen.getByRole('radio', { name: 'Exercises' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Archived' }));
  await screen.findByText(exercise.name);
  await fireEvent.press(screen.getByRole('button', { name: `Open exercise ${exercise.name}` }));
  await fireEvent.press(screen.getByRole('button', { name: 'Unarchive exercise' }));
  await screen.findByRole('button', { name: 'Archive exercise' });
  await fireEvent.press(screen.getByRole('button', { name: 'Close exercise' }));
  await waitFor(() => expect(screen.queryByText(exercise.name)).toBeNull());
  await fireEvent.press(screen.getByRole('radio', { name: 'Current' }));
  await screen.findByText(exercise.name);
  expect(request.mock.calls.filter((call) => call[1]).map((call) => call[1])).toEqual([
    expect.objectContaining({
      type: 'routine.unarchive',
      routineId: routine.id,
      expectedRevision: 7,
    }),
    expect.objectContaining({
      type: 'exercise.unarchive',
      exerciseId: exercise.id,
      expectedRevision: 4,
    }),
  ]);
});

it('does not let an older installation load replace the latest library', async () => {
  let finishOld!: (value: unknown) => void;
  const older = new Promise((resolve) => {
    finishOld = resolve;
  });
  const oldRequest = jest.fn(async (path: string) =>
    path === '/api/routines'
      ? older
      : path.startsWith('/api/exercises')
        ? { exercises: [] }
        : { routines: [] },
  );
  const newRequest = jest.fn(async (path: string) =>
    path.startsWith('/api/exercises')
      ? { exercises: [] }
      : { routines: path.includes('?') ? [] : [{ ...routine, archivedAt: null }] },
  );
  const view = await render(
    <Workouts client={clientWith(oldRequest)} preferences={defaultPreferences} />,
  );
  await view.rerender(
    <Workouts client={clientWith(newRequest)} preferences={defaultPreferences} />,
  );
  await screen.findByText(routine.name);
  await act(async () => {
    finishOld({ routines: [] });
  });
  await waitFor(() => expect(screen.getByText(routine.name)).toBeOnTheScreen());
});

it('starts the selected saved routine by its exact ID without recording a session from the library', async () => {
  const saved = { ...routine, archivedAt: null };
  const request = jest.fn(async (path: string) =>
    path.startsWith('/api/exercises')
      ? { exercises: [] }
      : { routines: path.includes('?') ? [] : [saved] },
  );
  const start = jest.fn();
  await render(
    <Workouts
      client={clientWith(request)}
      preferences={defaultPreferences}
      onStartRoutine={start}
    />,
  );
  await fireEvent.press(await screen.findByRole('button', { name: `Start ${saved.name}` }));
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith(saved.id);
  expect(request.mock.calls.every((call) => call.length === 1)).toBe(true);
});

it.each([
  { mode: 'bodyweight', reps: 0, addedLoadKg: null },
  { mode: 'timed', durationSeconds: null, loadKg: 0 },
  { mode: 'distance', distanceMeters: 1200, durationSeconds: null, loadKg: null },
] as const)(
  'retains $mode targets and snapshots when editing routine notes with targets collapsed',
  async (measurements) => {
    const item = {
      id: '00000000-0000-4000-8000-000000000003',
      exerciseId: exercise.id,
      snapshot: { name: 'Saved historical exercise', mode: measurements.mode, supportsLoad: true },
      notes: 'Keep exercise note',
      targets: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          kind: 'warmup' as const,
          measurements,
          notes: 'Keep set note',
        },
      ],
    };
    const saved = { ...routine, archivedAt: null, items: [item] };
    const request = jest.fn(
      async (path: string, body?: { operationId: string; content: object }) => {
        if (body)
          return {
            operationId: body.operationId,
            routine: { ...saved, ...body.content, revision: 8 },
            feedPosition: '1',
          };
        return path.startsWith('/api/exercises')
          ? { exercises: [] }
          : { routines: path.includes('?') ? [] : [saved] };
      },
    );
    await render(<Workouts client={clientWith(request)} preferences={defaultPreferences} />);
    await fireEvent.press(
      await screen.findByRole('button', { name: `Edit routine ${saved.name}` }),
    );
    expect(screen.queryByLabelText('Notes for set 1')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Routine notes'), 'Updated routine note');
    await fireEvent.press(screen.getByRole('button', { name: 'Save routine' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/routines/commands',
        expect.objectContaining({
          type: 'routine.edit',
          expectedRevision: 7,
          content: expect.objectContaining({ items: [item], notes: 'Updated routine note' }),
        }),
        'POST',
      ),
    );
  },
);
