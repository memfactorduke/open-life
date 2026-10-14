import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SignIn } from '../src/App';
import { createInstallationClient } from '../src/client';
import type { InstallationClient } from '../src/client';
import * as SecureStore from 'expo-secure-store';

jest.mock('../src/client', () => ({
  createInstallationClient: jest.fn(),
  SessionExpiredError: class extends Error {},
}));
jest.mock('expo-secure-store', () => ({ setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/SyncStatus', () => ({ SyncStatus: () => null }));
jest.mock('expo-notifications', () => ({}));
jest.mock('../src/offline/photo-export', () => ({}));
jest.mock('../src/features/AgentAccess', () => ({ AgentAccess: () => null }));
const factory = jest.mocked(createInstallationClient);
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_API_URL;
});
function installation(request = jest.fn().mockResolvedValue({ status: 'ok' })) {
  return {
    request,
    auth: { signIn: { email: jest.fn().mockResolvedValue({ error: null }) } },
  } as unknown as InstallationClient;
}

test('first setup verifies the space before requesting credentials; returning sign-in has no tour', async () => {
  const current = installation();
  factory.mockReturnValue(current);
  const signedIn = jest.fn().mockResolvedValue(undefined);
  await render(<SignIn onSignedIn={signedIn} />);
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.queryByText(/Contact its owner/)).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Space address'), 'https://fictional.example/');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByLabelText('Email address')).toBeTruthy());
  expect(current.request).toHaveBeenCalledWith('/api/health');
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'fictional@example.test');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'fixture-password');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(signedIn).toHaveBeenCalledWith(current));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'memslife_active_installation',
    'https://fictional.example',
  );
});

test('an unavailable or invalid space retains the address and never opens credential entry', async () => {
  factory.mockReturnValue(
    installation(jest.fn().mockRejectedValue(new Error('Space is unavailable.'))),
  );
  await render(<SignIn onSignedIn={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText('Space address'), 'https://fictional.example');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Space is unavailable.')).toBeTruthy());
  expect(screen.getByLabelText('Space address').props.value).toBe('https://fictional.example');
  expect(screen.queryByLabelText('Password')).toBeNull();
});

test('returning users enter credentials directly and changing space clears the password', async () => {
  await render(<SignIn installation="https://fictional.example" onSignedIn={jest.fn()} />);
  expect(screen.queryByLabelText('Space address')).toBeNull();
  await fireEvent.changeText(
    screen.getByLabelText('Password'),
    'do-not-carry-this-to-another-space',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Change space' }));
  factory.mockReturnValue(installation());
  await fireEvent.changeText(screen.getByLabelText('Space address'), 'https://other.example');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByLabelText('Password').props.value).toBe(''));
});
