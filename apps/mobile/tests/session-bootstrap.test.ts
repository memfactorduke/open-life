import { loadInstallationSession, verifiedSessionKey } from '../src/session-bootstrap';
import {
  NetworkUnavailableError,
  RequestRejectedError,
  SessionExpiredError,
  type InstallationClient,
} from '../src/client';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo-secure-store', () => ({}));
const origin = 'https://fictional.example';
const profile = {
  origin,
  me: {
    user: { id: 'owner-1', name: 'Morgan', email: 'morgan@example.com' },
    installationId: 'installation-1',
  },
  preferences: {
    revision: 1,
    value: {
      displayName: 'Morgan',
      timeZone: 'UTC',
      weightUnit: 'kg',
      distanceUnit: 'km',
      theme: 'system',
    },
  },
};
function fixture(
  saved: unknown = profile,
  failure: Error = new NetworkUnavailableError('offline'),
) {
  const storage = {
    getItemAsync: jest.fn().mockResolvedValue(saved == null ? null : JSON.stringify(saved)),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
  };
  const client = {
    baseURL: origin,
    request: jest.fn().mockRejectedValue(failure),
  } as unknown as InstallationClient;
  return { storage, client };
}
test('cold offline boot opens only the previously verified partition with an unverified-session label', async () => {
  const { storage, client } = fixture();
  await expect(loadInstallationSession(client, storage)).resolves.toEqual({
    me: profile.me,
    preferences: profile.preferences,
    authentication: 'offline',
  });
  expect(storage.getItemAsync).toHaveBeenCalledWith(verifiedSessionKey(origin));
  expect(storage.setItemAsync).not.toHaveBeenCalled();
});
test('legacy profile remains bound to its secure origin key', async () => {
  const legacy = { me: profile.me, preferences: profile.preferences };
  const { storage, client } = fixture(legacy);
  expect((await loadInstallationSession(client, storage)).authentication).toBe('offline');
});
test('verified owner and installation can use their cached profile when preferences are offline', async () => {
  const { storage, client } = fixture();
  jest.mocked(client.request).mockResolvedValueOnce(profile.me);
  await expect(loadInstallationSession(client, storage)).resolves.toEqual({
    me: profile.me,
    preferences: profile.preferences,
    authentication: 'offline',
  });
  expect(storage.deleteItemAsync).not.toHaveBeenCalled();
});
test.each([
  { ...profile.me, user: { ...profile.me.user, id: 'owner-2' } },
  { ...profile.me, installationId: 'installation-2' },
])('verified identity mismatch cannot open cached local work: %j', async (me) => {
  const { storage, client } = fixture();
  jest.mocked(client.request).mockResolvedValueOnce(me);
  await expect(loadInstallationSession(client, storage)).rejects.toBeInstanceOf(
    NetworkUnavailableError,
  );
  expect(client.request).toHaveBeenNthCalledWith(1, '/api/me');
  expect(client.request).toHaveBeenNthCalledWith(2, '/api/preferences');
  expect(storage.deleteItemAsync).not.toHaveBeenCalled();
  expect(storage.setItemAsync).not.toHaveBeenCalled();
});
test.each([
  null,
  {},
  { ...profile, origin: 'https://foreign.example' },
  { ...profile, me: { user: {} } },
  { ...profile, preferences: {} },
])('missing, foreign, or malformed profile fails closed: %j', async (saved) => {
  const { storage, client } = fixture(saved);
  await expect(loadInstallationSession(client, storage)).rejects.toBeInstanceOf(
    NetworkUnavailableError,
  );
});
test('revocation invalidates identity without opening or deleting queued local work', async () => {
  const { storage, client } = fixture(profile, new SessionExpiredError());
  await expect(loadInstallationSession(client, storage)).rejects.toBeInstanceOf(
    SessionExpiredError,
  );
  expect(storage.deleteItemAsync).toHaveBeenCalledWith(verifiedSessionKey(origin));
  expect(storage.getItemAsync).not.toHaveBeenCalled();
  expect(client.request).toHaveBeenCalledTimes(1);
});
test('unknown authorization errors never inspect cached identity', async () => {
  const { storage, client } = fixture(profile, new Error('AuthorizationRequired'));
  await expect(loadInstallationSession(client, storage)).rejects.toThrow('AuthorizationRequired');
  expect(storage.getItemAsync).not.toHaveBeenCalled();
});
test.each(['/api/me', '/api/preferences'])(
  'HTTP denial of bootstrap %s invalidates cached identity',
  async (path) => {
    const { storage, client } = fixture();
    jest.mocked(client.request).mockImplementation(async (requested) => {
      if (requested === path) throw new RequestRejectedError(403, 'Forbidden', 'FORBIDDEN');
      return profile.me;
    });
    await expect(loadInstallationSession(client, storage)).rejects.toMatchObject({ status: 403 });
    expect(storage.deleteItemAsync).toHaveBeenCalledWith(verifiedSessionKey(origin));
    expect(storage.getItemAsync).not.toHaveBeenCalled();
    storage.getItemAsync.mockResolvedValue(null);
    jest.mocked(client.request).mockRejectedValue(new NetworkUnavailableError('offline'));
    await expect(loadInstallationSession(client, storage)).rejects.toBeInstanceOf(
      NetworkUnavailableError,
    );
  },
);
test('online reauthentication refreshes the origin-bound profile and marks server verification', async () => {
  const { storage, client } = fixture();
  jest
    .mocked(client.request)
    .mockResolvedValueOnce(profile.me)
    .mockResolvedValueOnce(profile.preferences);
  expect((await loadInstallationSession(client, storage)).authentication).toBe('verified');
  expect(storage.setItemAsync).toHaveBeenCalledWith(
    verifiedSessionKey(origin),
    JSON.stringify(profile),
  );
});
