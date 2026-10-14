import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { defaultPreferences, type FoodEntry } from '@mems-life/domain';
import { Food } from '../src/features/Food';
import type { InstallationClient } from '../src/client';
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000009' }));
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('../src/offline-client', () => ({ useOfflineRevision: () => 0 }));
jest.mock('../src/media', () => ({ retainFoodPhoto: jest.fn(), uploadFoodPhoto: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
const now = '2026-10-13T12:00:00Z';
const entry: FoodEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  content: { text: 'Fictional lunch', occurredAt: now, timezone: 'UTC' },
  photoIds: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const client = (request: jest.Mock) =>
  ({ baseURL: 'https://fictional.example', auth: {}, request }) as unknown as InstallationClient;

it('preserves typed notes when another diary entry is selected', async () => {
  await render(
    <Food
      client={client(jest.fn(async () => ({ entries: [entry] })))}
      preferences={defaultPreferences()}
    />,
  );
  await screen.findByRole('button', { name: 'Edit entry' });
  await fireEvent.press(screen.getByRole('button', { name: 'Add entry', exact: true }));
  await fireEvent.changeText(screen.getByLabelText('What did you eat?'), 'Unsaved dinner');
  expect(screen.getByRole('button', { name: 'Edit entry' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit entry' }));
  expect(screen.getByLabelText('What did you eat?').props.value).toBe('Unsaved dinner');
});

it('a late history response cannot replace the newly selected date', async () => {
  let resolveOld!: (value: unknown) => void;
  const request = jest.fn((path: string) =>
    path.includes('date=2026-10-01')
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({
          entries: path.includes('date=2026-10-02')
            ? [{ ...entry, content: { ...entry.content, text: 'Newer day' } }]
            : [],
        }),
  );
  await render(<Food client={client(request)} preferences={defaultPreferences()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose day' }));
  await fireEvent(
    screen.getByLabelText('Diary day picker'),
    'valueChange',
    {},
    new Date('2026-10-01T12:00:00Z'),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Show day' }));
  await waitFor(() => expect(resolveOld).toBeDefined());
  await fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
  await screen.findByText('Newer day');
  await act(async () => resolveOld({ entries: [entry] }));
  expect(screen.getByText('Newer day')).toBeTruthy();
  expect(screen.queryByText('Fictional lunch')).toBeNull();
});

it('locks save and entry switching until photo selection finishes and then unlocks after cancel', async () => {
  let finish!: (value: ImagePicker.ImagePickerResult) => void;
  jest
    .mocked(ImagePicker.requestMediaLibraryPermissionsAsync)
    .mockResolvedValue({ granted: true } as never);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = jest.fn(async () => ({ entries: [entry] }));
  await render(<Food client={client(request)} preferences={defaultPreferences()} />);
  await screen.findByRole('button', { name: 'Edit entry' });
  await fireEvent.press(screen.getByRole('button', { name: 'Add entry', exact: true }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose photos' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit entry' })).toBeDisabled();
  expect(screen.getByLabelText('What did you eat?').props.editable).toBe(false);
  await act(async () => finish({ canceled: true, assets: null }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save entry' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Edit entry' })).toBeEnabled();
});

it('notification navigation preserves a photo-only entry timestamp correction', async () => {
  const photoOnly = { ...entry, content: { ...entry.content, text: '' } };
  const other = {
    ...entry,
    id: '00000000-0000-4000-8000-000000000002',
    content: { ...entry.content, text: 'Other entry' },
  };
  const request = jest.fn(async (path: string) =>
    path === `/api/food/${other.id}` ? { entry: other } : { entries: [photoOnly] },
  );
  const current = client(request);
  const view = await render(<Food client={current} preferences={defaultPreferences()} />);
  await screen.findByRole('button', { name: 'Edit entry' });
  await fireEvent.press(screen.getByRole('button', { name: 'Edit entry' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Edit time' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose date and time' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Enter timestamp manually' }));
  await fireEvent.changeText(
    screen.getByLabelText('Date and time timestamp'),
    '2026-10-12T12:00:00Z',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Apply date and time' }));
  await view.rerender(
    <Food client={current} preferences={defaultPreferences()} focusTarget={{ id: other.id }} />,
  );
  expect(
    screen.getByText('Your diary draft is retained. Save it before opening another entry.'),
  ).toBeTruthy();
  expect(request).not.toHaveBeenCalledWith(`/api/food/${other.id}`);
  expect(screen.getByLabelText('What did you eat?').props.value).toBe('');
});

it('starts with daily entries and keeps a canceled draft available to resume', async () => {
  await render(
    <Food
      client={client(jest.fn(async () => ({ entries: [entry] })))}
      preferences={defaultPreferences()}
    />,
  );
  await screen.findByText('Fictional lunch');
  expect(screen.queryByLabelText('What did you eat?')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete entry' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Add entry', exact: true }));
  await fireEvent.changeText(screen.getByLabelText('What did you eat?'), 'Dinner draft');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.queryByLabelText('What did you eat?')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Resume draft' }));
  expect(screen.getByLabelText('What did you eat?').props.value).toBe('Dinner draft');
});
