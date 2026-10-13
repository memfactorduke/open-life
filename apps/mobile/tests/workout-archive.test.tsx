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
