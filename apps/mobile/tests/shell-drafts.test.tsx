import { fireEvent, render, screen } from '@testing-library/react-native';
import { defaultPreferences } from '@mems-life/domain';
import { Shell } from '../src/App';
import type { InstallationClient } from '../src/client';
jest.mock('../src/client', () => ({
  createInstallationClient: jest.fn(),
  SessionExpiredError: class extends Error {},
}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('../src/SyncStatus', () => ({ SyncStatus: () => null }));
jest.mock('../src/features/Today', () => ({ Today: () => null }));
jest.mock('../src/features/Sessions', () => ({ Sessions: () => null }));
jest.mock('../src/features/Workouts', () => ({ Workouts: () => null }));
jest.mock('../src/features/Whoop', () => ({ Whoop: () => null }));
jest.mock('../src/features/Tasks', () => ({
  Tasks: function Draft() {
    const React = jest.requireActual<typeof import('react')>('react');
    const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
    const [value, setValue] = React.useState('');
    return <TextInput accessibilityLabel="Task draft" value={value} onChangeText={setValue} />;
  },
}));
jest.mock('../src/features/Food', () => ({
  Food: function Draft() {
    const React = jest.requireActual<typeof import('react')>('react');
    const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
    const [value, setValue] = React.useState('');
    return <TextInput accessibilityLabel="Food draft" value={value} onChangeText={setValue} />;
  },
}));
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: async () => null,
}));
jest.mock('../src/notifications', () => ({ clearNotificationsOnLogout: async () => undefined }));
jest.mock('../src/timers', () => ({ reconcileTimerAlert: async () => '' }));

it('retains task and food editor state through area switches and creates them only on first visit', async () => {
  const client = {
    baseURL: 'https://fictional.example',
    request: jest.fn(async () => {
      throw new Error('Offline');
    }),
  } as unknown as InstallationClient;
  await render(
    <Shell
      client={client}
      session={{
        me: {
          user: { id: 'owner', name: 'Fictional owner', email: 'fictional@example.test' },
          installationId: 'fixture',
        },
        preferences: { revision: 1, value: defaultPreferences() },
      }}
      onSaved={jest.fn()}
      onExpired={jest.fn()}
      onSignedOut={jest.fn()}
    />,
  );
  expect(screen.queryByLabelText('Task draft', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByLabelText('Food draft', { includeHiddenElements: true })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Today. Change area' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Tasks' }));
  await fireEvent.changeText(screen.getByLabelText('Task draft'), 'Unsaved task');
  await fireEvent.press(screen.getByRole('button', { name: 'Tasks. Change area' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Food' }));
  await fireEvent.changeText(screen.getByLabelText('Food draft'), 'Unsaved meal');
  await fireEvent.press(screen.getByRole('button', { name: 'Food. Change area' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Today. Change area' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Tasks' }));
  expect(screen.getByLabelText('Task draft').props.value).toBe('Unsaved task');
  await fireEvent.press(screen.getByRole('button', { name: 'Tasks. Change area' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Food' }));
  expect(screen.getByLabelText('Food draft').props.value).toBe('Unsaved meal');
});
